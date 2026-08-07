'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const TOTAL = 1000000;
const BATCH = 800;
const CLIENT_WORKERS = 100;

type ScanStatus = 'available' | 'registered' | 'unknown';
type Mode = 'server' | 'client';

interface Counts {
  available: number;
  registered: number;
  unknown: number;
  expiring: number;
  expired: number;
}

interface CloudProgress {
  tld: string;
  next: number;
  total: number;
  completed: boolean;
  updatedAt: number;
  counts: Counts;
}

// 到期信息接口
interface ExpiryInfo {
  domain: string;
  expiry: string;
  daysLeft: number;
  status: 'expiring' | 'expired';
}

const CLOUD_BASE =
  'https://raw.githubusercontent.com/tanle-mtr/domain-price-checker/main/data';

const DOH_PROVIDERS: ((name: string) => string)[] = [
  (name) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=NS`,
  (name) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=NS`,
];

async function dohCheck(full: string): Promise<ScanStatus> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = DOH_PROVIDERS[attempt % 2](full);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(url, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        });
        if (!res.ok) continue;
        const data = await res.json();
        const status = data.Status;
        if (status === 0) return 'registered';
        if (status === 3) return rdapConfirm(full);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 换下一个 provider 重试
    }
  }
  try {
    return await rdapConfirm(full);
  } catch {
    // 忽略
  }
  return 'unknown';
}

// NXDOMAIN 不代表未注册——已注册但未配置 NS 的域名同样无 NS 记录。
// 必须以注册局 RDAP（404=可注册）做最终确认。
async function rdapConfirm(full: string): Promise<ScanStatus> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      attempt === 0
        ? `https://rdap.centralnic.com/xyz/domain/${full}`
        : `https://rdap.org/domain/${full}`,
      { redirect: 'follow' }
    );
    if (res.status === 404) return 'available';
    if (res.status === 200) return 'registered';
  }
  return 'unknown';
}

export default function CheapDomainsPage() {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(TOTAL - 1);
  const [current, setCurrent] = useState(0);
  const [counts, setCounts] = useState<Counts>({
    available: 0,
    registered: 0,
    unknown: 0,
  });
  const [availableList, setAvailableList] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>('server');
  const [message, setMessage] = useState<string | null>(null);
  const [cloud, setCloud] = useState<{
    progress: CloudProgress | null;
    list: string[];
    loadingProgress: boolean;
    loadingList: boolean;
    error: string | null;
    search: string;
  }>({
    progress: null,
    list: [],
    loadingProgress: false,
    loadingList: false,
    error: null,
    search: '',
  });
  const [expiryData, setExpiryData] = useState<ExpiryInfo[]>([]);
  const [loadingExpiry, setLoadingExpiry] = useState(false);
  const [expiringSoonCount, setExpiringSoonCount] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);

  const runningRef = useRef(false);
  const availRef = useRef<string[]>([]);
  const countsRef = useRef<Counts>({ available: 0, registered: 0, unknown: 0 });
  const scannedRef = useRef(0);
  const nextIndexRef = useRef(0);
  const lastFlushedRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncFromState = useCallback(() => {
    availRef.current = availableList;
    countsRef.current = counts;
    scannedRef.current = Math.max(current - start, 0);
    nextIndexRef.current =
      current < start || current > end ? start : current;
    lastFlushedRef.current = availableList.length;
  }, [availableList, counts, current, start, end]);

  const flush = useCallback(() => {
    setCounts({ ...countsRef.current });
    const c = start + scannedRef.current;
    setCurrent(Math.min(c, end));
    if (availRef.current.length - lastFlushedRef.current >= 200) {
      lastFlushedRef.current = availRef.current.length;
      setAvailableList([...availRef.current]);
    }
  }, [start, end]);

  useEffect(() => {
    try {
      const c = localStorage.getItem('dp-scan-current');
      if (c) setCurrent(parseInt(c, 10) || 0);
      const cc = localStorage.getItem('dp-scan-counts');
      if (cc) setCounts(JSON.parse(cc));
      const a = localStorage.getItem('dp-scan-available');
      if (a) setAvailableList(JSON.parse(a));
      const s = localStorage.getItem('dp-scan-start');
      if (s) setStart(parseInt(s, 10) || 0);
      const e = localStorage.getItem('dp-scan-end');
      if (e) setEnd(parseInt(e, 10) || TOTAL - 1);
      const m = localStorage.getItem('dp-scan-mode');
      if (m === 'client' || m === 'server') setMode(m);
    } catch {
      // 存储不可用则忽略
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-current', String(current));
    } catch {
      // 忽略
    }
  }, [current]);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-counts', JSON.stringify(counts));
    } catch {
      // 忽略
    }
  }, [counts]);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-available', JSON.stringify(availableList));
    } catch {
      // 超出存储配额时仅保留在内存中
    }
  }, [availableList]);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-start', String(start));
    } catch {
      // 忽略
    }
  }, [start]);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-end', String(end));
    } catch {
      // 忽略
    }
  }, [end]);

  useEffect(() => {
    try {
      localStorage.setItem('dp-scan-mode', mode);
    } catch {
      // 忽略
    }
  }, [mode]);

  const record = useCallback((status: ScanStatus, full: string) => {
    scannedRef.current += 1;
    if (status === 'available') {
      availRef.current.push(full);
      countsRef.current.available += 1;
    } else if (status === 'registered') {
      countsRef.current.registered += 1;
    } else {
      countsRef.current.unknown += 1;
    }
  }, []);

  const cacheMapRef = useRef(new Map<number, { a: string[]; dirty: boolean; mtime: number }>());
  const cachedHitsRef = useRef(0);

  const loadCacheChunk = useCallback((base: number) => {
    let ch = cacheMapRef.current.get(base);
    if (!ch) {
      let arr: string[] = [];
      try {
        const raw = localStorage.getItem(`dp-cache-xyz-${base}`);
        if (raw) arr = JSON.parse(raw);
      } catch {
        arr = [];
      }
      ch = { a: arr, dirty: false, mtime: Date.now() };
      cacheMapRef.current.set(base, ch);
    }
    return ch;
  }, []);

  const cacheGetN = useCallback(
    (n: number): ScanStatus | null => {
      const base = Math.floor(n / 1000) * 1000;
      const c = loadCacheChunk(base).a[n - base];
      if (c === 'a') return 'available';
      if (c === 'r') return 'registered';
      if (c === 'u') return 'unknown';
      return null;
    },
    [loadCacheChunk]
  );

  const cacheSetN = useCallback(
    (n: number, s: ScanStatus) => {
      const base = Math.floor(n / 1000) * 1000;
      const ch = loadCacheChunk(base);
      ch.a[n - base] = s === 'available' ? 'a' : s === 'registered' ? 'r' : 'u';
      ch.dirty = true;
      ch.mtime = Date.now();
    },
    [loadCacheChunk]
  );

  const flushCache = useCallback(() => {
    for (const [base, ch] of cacheMapRef.current) {
      if (!ch.dirty) continue;
      try {
        localStorage.setItem(`dp-cache-xyz-${base}`, JSON.stringify(ch.a));
        ch.dirty = false;
      } catch {
        cacheMapRef.current.delete(base);
      }
    }
  }, []);

  const runServer = useCallback(async () => {
    runningRef.current = true;
    setRunning(true);
    setMessage(null);
    let c = current < start || current > end ? start : current;
    lastFlushedRef.current = availRef.current.length;
    while (runningRef.current && c <= end) {
      try {
        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: c, count: BATCH, concurrency: 100 }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || '扫描请求失败');
        }
        c = data.next;
        scannedRef.current = c - start;
        for (const d of data.available as string[]) {
          availRef.current.push(d);
          countsRef.current.available += 1;
        }
        countsRef.current.registered += data.registered;
        countsRef.current.unknown += data.unknown;
        if (c % (BATCH * 2) === 0) flush();
      } catch (e) {
        flush();
        setMessage(
          `扫描中断（第 ${c.toLocaleString()} 个）：${
            e instanceof Error ? e.message : String(e)
          }，可稍后点击"继续扫描"`
        );
        break;
      }
    }
    flush();
    runningRef.current = false;
    setRunning(false);
    if (c > end) setMessage('扫描完成！');
  }, [current, start, end, flush]);

  const runClient = useCallback(async () => {
    runningRef.current = true;
    setRunning(true);
    setMessage(null);
    syncFromState();
    lastFlushedRef.current = availRef.current.length;

    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncTimerRef.current = setInterval(() => {
      if (runningRef.current) {
        flush();
        flushCache();
      }
    }, 500);

    const worker = async () => {
      while (runningRef.current) {
        const n = nextIndexRef.current++;
        if (n > end) break;
        const full = `${String(n).padStart(6, '0')}.xyz`;
        const cached = cacheGetN(n);
        let status: ScanStatus;
        if (cached) {
          cachedHitsRef.current += 1;
          status = cached;
        } else {
          status = await dohCheck(full);
          cacheSetN(n, status);
        }
        record(status, full);
      }
    };
    await Promise.all(
      Array.from({ length: CLIENT_WORKERS }, () => worker())
    );
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    flushCache();
    flush();
    runningRef.current = false;
    setRunning(false);
    if (start + scannedRef.current > end) {
      const hits = cachedHitsRef.current;
      setMessage(hits > 0 ? `扫描完成！缓存命中 ${hits.toLocaleString()} 个域名，零请求跳过` : '扫描完成！');
    }
  }, [start, end, flush, syncFromState, record, flushCache, cacheGetN, cacheSetN]);

  const stop = () => {
    runningRef.current = false;
  };

  const reset = () => {
    runningRef.current = false;
    setRunning(false);
    availRef.current = [];
    countsRef.current = { available: 0, registered: 0, unknown: 0 };
    scannedRef.current = 0;
    nextIndexRef.current = start;
    lastFlushedRef.current = 0;
    setCurrent(start);
    setCounts({ available: 0, registered: 0, unknown: 0 });
    setAvailableList([]);
    setMessage(null);
    try {
      localStorage.removeItem('dp-scan-current');
      localStorage.removeItem('dp-scan-counts');
      localStorage.removeItem('dp-scan-available');
    } catch {
      // 忽略
    }
  };

  const exportTxt = () => {
    const list = availRef.current.length > 0 ? availRef.current : availableList;
    if (list.length === 0) return;
    const blob = new Blob([list.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xyz-available-domains.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadCloudProgress = useCallback(async () => {
    setCloud((c) => ({ ...c, loadingProgress: true, error: null }));
    try {
      const res = await fetch(`${CLOUD_BASE}/scan-progress.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const progress = await res.json();
      setCloud((c) => ({ ...c, progress, loadingProgress: false }));
    } catch (e) {
      setCloud((c) => ({
        ...c,
        loadingProgress: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const loadCloudList = useCallback(async () => {
    if (!cloud.progress) return;
    setCloud((c) => ({ ...c, loadingList: true, error: null }));
    try {
      const urls = Array.from({ length: 10 }, (_, i) => {
        const from = String(i * 100000).padStart(6, '0');
        const to = String(Math.min((i + 1) * 100000, 1000000) - 1).padStart(6, '0');
        return `${CLOUD_BASE}/available/xyz-${from}-${to}.txt?t=${Date.now()}`;
      });
      const texts = await Promise.all(
        urls.map(async (u) => {
          const r = await fetch(u, { cache: 'no-store' });
          return r.ok ? r.text() : '';
        })
      );
      const all = texts.flatMap((t) => (t ? t.split('\n').filter(Boolean) : []));
      setCloud((c) => ({ ...c, list: all, loadingList: false }));
    } catch (e) {
      setCloud((c) => ({
        ...c,
        loadingList: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [cloud.progress]);

  const exportCloud = () => {
    const filtered = cloud.search
      ? cloud.list.filter((d) => d.includes(cloud.search))
      : cloud.list;
    if (filtered.length === 0) return;
    const blob = new Blob([filtered.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cloud.search
      ? `xyz-available-${cloud.search}.txt`
      : 'xyz-available-domains.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 加载到期数据
  const loadExpiryData = useCallback(async () => {
    setLoadingExpiry(true);
    setExpiryData([]);
    try {
      const ranges = Array.from({ length: 10 }, (_, i) => i);
      const expiryResults = await Promise.all(
        ranges.map(async (i) => {
          const from = String(i * 100000).padStart(6, '0');
          const to = String(Math.min((i + 1) * 100000, 1000000) - 1).padStart(6, '0');
          const res = await fetch(`${CLOUD_BASE}/expiring/xyz-${from}-${to}.txt?t=${Date.now()}`, {
            cache: 'no-store'
          });
          return res.ok ? res.text() : '';
        })
      );
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const soonExpiry = 30; // 30天内到期
      
      const processed: ExpiryInfo[] = [];
      let expiringSoon = 0;
      let expired = 0;
      
      for (const text of expiryResults) {
        if (!text) continue;
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          const idx = line.indexOf('\t');
          if (idx < 0) continue;
          const domain = line.slice(0, idx);
          const expiryDate = line.slice(idx + 1);
          if (!expiryDate) continue;
          
          const expiry = new Date(expiryDate);
          const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          let status: 'expiring' | 'expired' = 'expiring';
          if (daysLeft < 0) {
            status = 'expired';
            expired++;
          } else if (daysLeft <= soonExpiry) {
            expiringSoon++;
          }
          
          processed.push({ domain, expiry: expiryDate, daysLeft, status });
        }
      }
      
      setExpiryData(processed);
      setExpiringSoonCount(expiringSoon);
      setExpiredCount(expired);
    } catch (e) {
      console.error('Failed to load expiry data:', e);
    } finally {
      setLoadingExpiry(false);
    }
  }, []);

  // 导出到期域名列表
  const exportExpiry = () => {
    if (expiryData.length === 0) return;
    const blob = new Blob([expiryData.map(d => `${d.domain}\t${d.expiry}\t${d.daysLeft}天`).join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'xyz-expiry-domains.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = end - start + 1;
  const scanned = Math.min(Math.max(current - start, 0), total);
  const percent = total > 0 ? Math.min((scanned / total) * 100, 100) : 0;

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadCloudProgress();
  }, [loadCloudProgress]);

  useEffect(() => {
    loadExpiryData();
  }, [loadExpiryData]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <span className="inline-block rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          百万域名扫描
        </span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          便宜域名
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          批量扫描 6 位数字 .xyz 域名（000000–999999，共 100 万个），筛选未注册域名并导出 TXT
        </p>
      </header>

      <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm transition-colors dark:border-emerald-800/60 dark:bg-emerald-950/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-200">
              云端后台扫描（GitHub Actions Worker）
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              服务器全天候自动扫描 000000–999999 的 .xyz 域名，结果已备好，打开即用、无需等待
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadCloudProgress}
              disabled={cloud.loadingProgress}
              className="rounded-lg border border-emerald-400 px-4 py-2 text-sm text-emerald-700 transition-colors hover:border-emerald-500 disabled:opacity-50 dark:text-emerald-300"
            >
              {cloud.loadingProgress ? '刷新中…' : '刷新状态'}
            </button>
            <button
              onClick={loadCloudList}
              disabled={cloud.loadingList || !cloud.progress}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {cloud.loadingList ? '加载中…' : '加载未注册列表'}
            </button>
          </div>
        </div>

        {cloud.progress && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>
                已扫描 {cloud.progress.next.toLocaleString()} /{' '}
                {cloud.progress.total.toLocaleString()} (
                {Math.min((cloud.progress.next / cloud.progress.total) * 100, 100).toFixed(2)}
                %)
              </span>
              <span>
                {cloud.progress.completed
                  ? `已完成 · 更新于 ${new Date(cloud.progress.updatedAt).toLocaleString()}`
                  : `扫描中 · 更新于 ${new Date(cloud.progress.updatedAt).toLocaleString()}`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-emerald-200 dark:bg-slate-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min((cloud.progress.next / cloud.progress.total) * 100, 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <span className="font-medium text-emerald-600 dark:text-emerald-300">
                未注册：{cloud.progress.counts.available.toLocaleString()}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                已注册：{cloud.progress.counts.registered.toLocaleString()}
              </span>
              <span className="text-amber-600 dark:text-amber-300">
                未知：{cloud.progress.counts.unknown.toLocaleString()}
              </span>
              {cloud.progress.counts.expiring > 0 && (
                <span className="font-medium text-orange-600 dark:text-orange-300">
                  即将到期：{cloud.progress.counts.expiring.toLocaleString()}
                </span>
              )}
              {cloud.progress.counts.expired > 0 && (
                <span className="font-medium text-red-600 dark:text-red-300">
                  已过期：{cloud.progress.counts.expired.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 到期域名提醒 */}
        {(expiringSoonCount > 0 || expiredCount > 0) && (
          <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50/60 p-4 shadow-sm dark:border-orange-800/60 dark:bg-orange-950/30">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-orange-700 dark:text-orange-200">
                  ⚠️ 到期域名提醒
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {expiringSoonCount > 0 && (
                    <span className="mr-4">
                      <span className="font-medium text-orange-600 dark:text-orange-300">
                        {expiringSoonCount.toLocaleString()}
                      </span> 个域名将在30天内到期，抓紧抢注
                    </span>
                  )}
                  {expiredCount > 0 && (
                    <span>
                      <span className="font-medium text-red-600 dark:text-red-300">
                        {expiredCount.toLocaleString()}
                      </span> 个域名已过期可立即注册
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={loadExpiryData}
                  disabled={loadingExpiry}
                  className="rounded-lg border border-orange-400 px-4 py-2 text-sm text-orange-700 transition-colors hover:border-orange-500 disabled:opacity-50 dark:text-orange-300"
                >
                  {loadingExpiry ? '加载中…' : '刷新到期数据'}
                </button>
                <button
                  onClick={exportExpiry}
                  disabled={expiryData.length === 0}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-40"
                >
                  导出到期列表
                </button>
              </div>
            </div>
            {expiryData.length > 0 && (
              <div className="mt-3 max-h-40 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 md:grid-cols-6">
                  {expiryData.slice(0, 30).map((info) => (
                    <div
                      key={info.domain}
                      className={`flex items-center gap-1 ${
                        info.status === 'expired'
                          ? 'text-red-600 dark:text-red-300'
                          : 'text-orange-600 dark:text-orange-300'
                      }`}
                    >
                      <span className="font-medium">{info.domain}</span>
                      <span className="text-xs opacity-75">
                        {info.daysLeft < 0 ? `已过期${Math.abs(info.daysLeft)}天` : `${info.daysLeft}天`}
                      </span>
                    </div>
                  ))}
                </div>
                {expiryData.length > 30 && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    还有 {expiryData.length - 30} 个域名，请导出查看完整列表
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {cloud.error && (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            云端数据获取失败：{cloud.error}（worker 可能尚未启动或首次构建中，可稍后刷新）
          </p>
        )}

        {cloud.list.length > 0 && (
          <div className="mt-5 border-t border-emerald-200 pt-4 dark:border-emerald-900/60">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-300">
                已加载{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-300">
                  {cloud.list.length.toLocaleString()}
                </span>{' '}
                个未注册域名
              </span>
              <input
                value={cloud.search}
                onChange={(e) => setCloud((c) => ({ ...c, search: e.target.value }))}
                placeholder="搜索（如 888 或 123）"
                className="w-44 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                onClick={exportCloud}
                disabled={cloud.list.length === 0}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                导出
                {cloud.search
                  ? `筛选(${cloud.list.filter((d) => d.includes(cloud.search)).length})`
                  : '全部'}{' '}
                TXT
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4 md:grid-cols-6">
              {cloud.list
                .filter((d) => (cloud.search ? d.includes(cloud.search) : true))
                .slice(0, 60)
                .map((d) => (
                  <span key={d} className="font-medium text-emerald-600 dark:text-emerald-300">
                    {d}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <button
            onClick={() => setMode('server')}
            disabled={running}
            className={`rounded-lg px-4 py-2 transition-colors ${
              mode === 'server'
                ? 'bg-blue-600 text-white'
                : 'border border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500'
            }`}
          >
            服务端扫描
          </button>
          <button
            onClick={() => setMode('client')}
            disabled={running}
            className={`rounded-lg px-4 py-2 transition-colors ${
              mode === 'client'
                ? 'bg-blue-600 text-white'
                : 'border border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500'
            }`}
          >
            浏览器直扫（最快）
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm text-slate-500 dark:text-slate-400">
            起始
            <input
              type="number"
              min={0}
              max={999999}
              value={start}
              onChange={(e) =>
                setStart(
                  Math.min(Math.max(parseInt(e.target.value, 10) || 0, 0), 999999)
                )
              }
              className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="text-sm text-slate-500 dark:text-slate-400">
            结束
            <input
              type="number"
              min={0}
              max={999999}
              value={end}
              onChange={(e) =>
                setEnd(
                  Math.min(Math.max(parseInt(e.target.value, 10) || 0, 0), 999999)
                )
              }
              className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <button
            onClick={mode === 'client' ? runClient : runServer}
            disabled={running}
            className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {running ? '扫描中…' : '开始 / 继续扫描'}
          </button>
          {running && (
            <button
              onClick={stop}
              className="rounded-lg border border-slate-300 px-6 py-2.5 text-slate-600 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
            >
              暂停
            </button>
          )}
          <button
            onClick={reset}
            className="rounded-lg border border-slate-300 px-6 py-2.5 text-slate-600 transition-colors hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
          >
            重置进度
          </button>
          <button
            onClick={exportTxt}
            disabled={(availRef.current.length > 0 ? availRef.current : availableList).length === 0}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            导出 TXT（
            {(availRef.current.length > 0 ? availRef.current : availableList).length.toLocaleString()}
            ）
          </button>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>
              进度：{scanned.toLocaleString()} / {total.toLocaleString()} (
              {percent.toFixed(2)}%)
            </span>
            <span>当前：{String(Math.min(current, end)).padStart(6, '0')}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span className="font-medium text-emerald-600 dark:text-emerald-300">
            可注册：{counts.available.toLocaleString()}
          </span>
          <span className="text-red-600 dark:text-red-300">
            已注册：{counts.registered.toLocaleString()}
          </span>
          <span className="text-amber-600 dark:text-amber-300">
            未知：{counts.unknown.toLocaleString()}
          </span>
        </div>

        {message && (
          <p className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            {message}
          </p>
        )}

        {mode === 'client' && (
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            浏览器直扫模式：直接向
            Cloudflare/Google DNS 的 DoH 接口查询（无需经过服务器，无 60s
            限制），DNS 报 NXDOMAIN 后再经注册局 RDAP
            确认（404 才算可注册），避免误报已注册域名。需保持本页面打开。
          </p>
        )}
        {mode === 'server' && (
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            服务端扫描：每批 {BATCH} 个、100 并发，通过服务器 DNS
            预筛选 + 注册局 RDAP 确认，稳定性优于浏览器直扫。
          </p>
        )}
      </div>

      {availableList.length > 0 && (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-3 text-lg font-semibold">
            已发现未注册域名（前 100 条，完整列表请导出 TXT）
          </h2>
          <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4 md:grid-cols-6">
            {availableList.slice(0, 100).map((d) => (
              <span key={d} className="font-medium text-emerald-600 dark:text-emerald-300">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-600">
        进度自动保存，可随时暂停后改天继续；DNS 判定可能有个别误差，购买前请在注册商结算页确认
      </p>
    </main>
  );
}