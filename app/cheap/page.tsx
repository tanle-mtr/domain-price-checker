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
}

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
        if (status === 3) return 'available';
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 换下一个 provider 重试
    }
  }
  try {
    const res = await fetch(`https://rdap.org/domain/${full}`, {
      redirect: 'follow',
    });
    if (res.status === 404) return 'available';
    if (res.status === 200) return 'registered';
  } catch {
    // 忽略
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
      if (runningRef.current) flush();
    }, 500);

    const worker = async () => {
      while (runningRef.current) {
        const n = nextIndexRef.current++;
        if (n > end) break;
        const full = `${String(n).padStart(6, '0')}.xyz`;
        const status = await dohCheck(full);
        record(status, full);
      }
    };
    await Promise.all(
      Array.from({ length: CLIENT_WORKERS }, () => worker())
    );
    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    flush();
    runningRef.current = false;
    setRunning(false);
    if (start + scannedRef.current > end) setMessage('扫描完成！');
  }, [start, end, flush, syncFromState, record]);

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

  const total = end - start + 1;
  const scanned = Math.min(Math.max(current - start, 0), total);
  const percent = total > 0 ? Math.min((scanned / total) * 100, 100) : 0;

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl">便宜域名</h1>
        <p className="mt-2 text-slate-400">
          批量扫描 6 位数字 .xyz 域名（000000–999999，共 100 万个），筛选未注册域名并导出 TXT
        </p>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <button
            onClick={() => setMode('server')}
            disabled={running}
            className={`rounded-lg px-4 py-2 transition-colors ${
              mode === 'server'
                ? 'bg-blue-600 text-white'
                : 'border border-slate-700 text-slate-300 hover:border-slate-500'
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
                : 'border border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            浏览器直扫（最快）
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm text-slate-400">
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
              className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-sm text-slate-400">
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
              className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <button
            onClick={mode === 'client' ? runClient : runServer}
            disabled={running}
            className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {running ? '扫描中…' : '开始 / 继续扫描'}
          </button>
          {running && (
            <button
              onClick={stop}
              className="rounded-lg border border-slate-700 px-6 py-2.5 text-slate-300 hover:border-slate-500"
            >
              暂停
            </button>
          )}
          <button
            onClick={reset}
            className="rounded-lg border border-slate-700 px-6 py-2.5 text-slate-300 hover:border-slate-500"
          >
            重置进度
          </button>
          <button
            onClick={exportTxt}
            disabled={(availRef.current.length > 0 ? availRef.current : availableList).length === 0}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            导出 TXT（
            {(availRef.current.length > 0 ? availRef.current : availableList).length.toLocaleString()}
            ）
          </button>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
            <span>
              进度：{scanned.toLocaleString()} / {total.toLocaleString()} (
              {percent.toFixed(2)}%)
            </span>
            <span>当前：{String(Math.min(current, end)).padStart(6, '0')}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span className="text-emerald-300">
            可注册：{counts.available.toLocaleString()}
          </span>
          <span className="text-red-300">
            已注册：{counts.registered.toLocaleString()}
          </span>
          <span className="text-amber-300">
            未知：{counts.unknown.toLocaleString()}
          </span>
        </div>

        {message && (
          <p className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-300">
            {message}
          </p>
        )}

        {mode === 'client' && (
          <p className="mt-4 text-xs text-slate-500">
            浏览器直扫模式：直接向
            Cloudflare/Google DNS 的 DoH 接口查询（无需经过服务器，无 60s
            限制），DNS 报 NXDOMAIN 即判为可注册；DNS 失败才降级到
            rdap.org 确认。需保持本页面打开。
          </p>
        )}
        {mode === 'server' && (
          <p className="mt-4 text-xs text-slate-500">
            服务端扫描：每批 {BATCH} 个、100 并发，通过服务器 DNS
            预筛选 + 直连注册局确认，稳定性优于浏览器直扫。
          </p>
        )}
      </div>

      {availableList.length > 0 && (
        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-3 text-lg font-semibold">
            已发现未注册域名（前 100 条，完整列表请导出 TXT）
          </h2>
          <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4 md:grid-cols-6">
            {availableList.slice(0, 100).map((d) => (
              <span key={d} className="text-emerald-300">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-slate-600">
        进度自动保存，可随时暂停后改天继续；DNS 判定可能有个别误差，购买前请在注册商结算页确认
      </p>
    </main>
  );
}