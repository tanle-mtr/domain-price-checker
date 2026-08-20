import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const net = require('node:net');
const dns = require('node:dns');
const util = require('node:util');

process.on('unhandledRejection', (r) => {
  console.error('[scan] unhandledRejection:', r);
  process.exit(2);
});
process.on('uncaughtException', (e) => {
  console.error('[scan] uncaughtException:', e);
  process.exit(3);
});
process.on('exit', (code) => {
  console.error(`[scan] process exit code=${code}`);
});
process.on('beforeExit', () => {
  console.error('[scan] beforeExit: event loop drained');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.GITHUB_WORKSPACE || path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data');
const AVAIL_DIR = path.join(DATA, 'available');
const REG_DIR = path.join(DATA, 'registered');
const PROGRESS_FILE = path.join(DATA, 'scan-progress.json');

const TLD = process.env.SCAN_TLD || 'xyz';
const TOTAL = Number(process.env.SCAN_TOTAL || 1000000);
const START = Number(process.env.SCAN_START || 0);
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 100);
const COMMIT_EVERY = Number(process.env.COMMIT_EVERY || 100000);
const DO_COMMIT = process.env.COMMIT === '1';
const DEBUG = process.env.SCAN_DEBUG === '1';
const FORCE = process.env.SCAN_FORCE === '1';
const FRESH_HOURS = Number(process.env.SCAN_FRESH_HOURS || 24);
const FRESH_MS = FRESH_HOURS * 3600 * 1000;
const DNS_TIMEOUT_MS = 2000;
const RDAP_TIMEOUT_MS = 5000;
const RANGE = 100000;
const EXPIRY_DIR = path.join(DATA, 'expiring');
const CONFIRMED_DIR = path.join(DATA, 'confirmed');
const EXPIRY_CHECK_HOURS = 24; // 到期前24小时开始检测

// 到期阈值: 30天内到期的域名视为"即将到期"
const SOON_EXPIRY_DAYS = 30;

let dohIndex = 0;
const DOH_PROVIDERS = [
  (name) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=NS`,
  (name) =>
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=NS`,
  (name) =>
    `https://doh.libredns.gr/dns-query?name=${encodeURIComponent(name)}&type=NS`,
  (name) =>
    `https://dns.quad9.net/dns-query?name=${encodeURIComponent(name)}&type=NS`,
];
const DOH_TYPES = ['NS', 'A', 'SOA'];

let totalAvailable = 0;
let totalRegistered = 0;
let skippedRegistered = 0;
let queriedCount = 0;
let totalExpiring = 0; // 即将到期域名数
let totalExpired = 0; // 已过期域名数
let totalConfirmed = 0; // 二次确认域名数
const availByRange = new Map();
const registeredByRange = new Map();
const expiryByRange = new Map();
const confirmedByRange = new Map();
const dirtyRanges = new Set();
const dirtyRegisteredRanges = new Set();
const dirtyExpiryRanges = new Set();
const dirtyConfirmedRanges = new Set();
let debugCount = 0;

function loadJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function rangeIndex(n) {
  return Math.floor(n / RANGE);
}

function rangeFile(ri) {
  const from = String(ri * RANGE).padStart(6, '0');
  const to = String(Math.min((ri + 1) * RANGE, TOTAL) - 1).padStart(6, '0');
  return path.join(AVAIL_DIR, `${TLD}-${from}-${to}.txt`);
}

function registeredFile(ri) {
  const from = String(ri * RANGE).padStart(6, '0');
  const to = String(Math.min((ri + 1) * RANGE, TOTAL) - 1).padStart(6, '0');
  return path.join(REG_DIR, `${TLD}-${from}-${to}.txt`);
}

function loadNumSet(file) {
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => parseInt(line.split('.')[0], 10))
      .filter((n) => Number.isInteger(n))
  );
}

function loadRange(ri) {
  return loadNumSet(rangeFile(ri));
}

function loadRegisteredRange(ri) {
  return loadNumSet(registeredFile(ri));
}

function expiryFile(ri) {
  const from = String(ri * RANGE).padStart(6, '0');
  const to = String(Math.min((ri + 1) * RANGE, TOTAL) - 1).padStart(6, '0');
  return path.join(EXPIRY_DIR, `${TLD}-${from}-${to}.txt`);
}

function confirmedFile(ri) {
  const from = String(ri * RANGE).padStart(6, '0');
  const to = String(Math.min((ri + 1) * RANGE, TOTAL) - 1).padStart(6, '0');
  return path.join(CONFIRMED_DIR, `${TLD}-${from}-${to}.txt`);
}

function loadExpiryRange(ri) {
  const f = expiryFile(ri);
  if (!existsSync(f)) return new Map();
  return new Map(
    readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf('\t');
        return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, null];
      })
  );
}

function loadConfirmedRange(ri) {
  const f = confirmedFile(ri);
  if (!existsSync(f)) return new Set();
  return new Set(
    readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => parseInt(line.split('.')[0], 10))
      .filter((n) => Number.isInteger(n))
  );
}

function preloadExpiry() {
  let loaded = 0;
  for (let ri = 0; ri < Math.ceil(TOTAL / RANGE); ri++) {
    const map = loadExpiryRange(ri);
    if (map.size) {
      expiryByRange.set(ri, map);
      loaded += map.size;
    }
  }
  if (loaded) {
    console.log(`[scan] preloaded expiry index: ${loaded.toLocaleString()} domains`);
  }
}

function preloadConfirmed() {
  let loaded = 0;
  for (let ri = 0; ri < Math.ceil(TOTAL / RANGE); ri++) {
    const set = loadConfirmedRange(ri);
    if (set.size) {
      confirmedByRange.set(ri, set);
      loaded += set.size;
    }
  }
  if (loaded) {
    console.log(`[scan] preloaded confirmed index: ${loaded.toLocaleString()} domains`);
  }
}

function isRegisteredIn(n) {
  const set = registeredByRange.get(rangeIndex(n));
  return !!set && set.has(n);
}

function addRegistered(n) {
  const ri = rangeIndex(n);
  let set = registeredByRange.get(ri);
  if (!set) {
    set = new Set(loadRegisteredRange(ri));
    registeredByRange.set(ri, set);
  }
  set.add(n);
  dirtyRegisteredRanges.add(ri);
}

function preloadRegistered() {
  let loaded = 0;
  for (let ri = 0; ri < Math.ceil(TOTAL / RANGE); ri++) {
    const set = loadRegisteredRange(ri);
    if (set.size) {
      registeredByRange.set(ri, set);
      loaded += set.size;
    }
  }
  if (loaded) {
    console.log(`[scan] preloaded registered index: ${loaded.toLocaleString()} domains (will skip them)`);
  }
}

function addExpiry(n, expiry) {
  const ri = rangeIndex(n);
  let map = expiryByRange.get(ri);
  if (!map) {
    map = loadExpiryRange(ri);
    expiryByRange.set(ri, map);
  }
  map.set(n, expiry);
  dirtyExpiryRanges.add(ri);
}

function addConfirmed(n) {
  const ri = rangeIndex(n);
  let set = confirmedByRange.get(ri);
  if (!set) {
    set = new Set(loadConfirmedRange(ri));
    confirmedByRange.set(ri, set);
  }
  set.add(n);
  dirtyConfirmedRanges.add(ri);
}

function isExpiringSoon(n, today) {
  const ri = rangeIndex(n);
  const map = expiryByRange.get(ri);
  if (!map) return false;
  const expiry = map.get(n);
  if (!expiry) return false;
  const expiryDate = new Date(expiry);
  const daysUntil = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntil <= SOON_EXPIRY_DAYS && daysUntil >= 0;
}

function isExpired(n, today) {
  const ri = rangeIndex(n);
  const map = expiryByRange.get(ri);
  if (!map) return false;
  const expiry = map.get(n);
  if (!expiry) return false;
  return new Date(expiry) < today;
}

  function save(prog) {
    writeFileSync(`${PROGRESS_FILE}.tmp`, JSON.stringify(prog, null, 2));
    renameSync(`${PROGRESS_FILE}.tmp`, PROGRESS_FILE);
    for (const ri of dirtyRanges) {
      const nums = [...(availByRange.get(ri) || [])].sort((a, b) => a - b);
      const lines =
        nums.map((n) => `${String(n).padStart(6, '0')}.${TLD}`).join('\n') +
        (nums.length ? '\n' : '');
      const f = rangeFile(ri);
      writeFileSync(`${f}.tmp`, lines);
      renameSync(`${f}.tmp`, f);
    }
    dirtyRanges.clear();
    for (const ri of dirtyRegisteredRanges) {
      const nums = [...(registeredByRange.get(ri) || [])].sort((a, b) => a - b);
      const lines =
        nums.map((n) => `${String(n).padStart(6, '0')}.${TLD}`).join('\n') +
        (nums.length ? '\n' : '');
      const f = registeredFile(ri);
      writeFileSync(`${f}.tmp`, lines);
      renameSync(`${f}.tmp`, f);
    }
    dirtyRegisteredRanges.clear();
    for (const ri of dirtyExpiryRanges) {
      const map = expiryByRange.get(ri);
      if (!map || map.size === 0) continue;
      const lines = [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([n, exp]) => `${String(n).padStart(6, '0')}.${TLD}\t${exp ?? ''}`)
        .join('\n') + '\n';
      const f = expiryFile(ri);
      writeFileSync(`${f}.tmp`, lines);
      renameSync(`${f}.tmp`, f);
    }
    dirtyExpiryRanges.clear();
    for (const ri of dirtyConfirmedRanges) {
      const nums = [...(confirmedByRange.get(ri) || [])].sort((a, b) => a - b);
      const lines = nums.map((n) => `${String(n).padStart(6, '0')}.${TLD}`).join('\n') + '\n';
      const f = confirmedFile(ri);
      writeFileSync(`${f}.tmp`, lines);
      renameSync(`${f}.tmp`, f);
    }
    dirtyConfirmedRanges.clear();
  }

function cleanupHistory() {
  if (!DO_COMMIT) return;
  let base;
  try {
    base = execSync(`git rev-list -1 HEAD -- ':(exclude)data'`, {
      cwd: REPO,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0];
  } catch {
    console.error('[scan] cleanup: base lookup failed, keep history as-is');
    return;
  }
  if (!base) {
    console.log('[scan] cleanup: no base commit found, skip');
    return;
  }
  try {
    console.log(`[scan] squash data commits onto ${base.slice(0, 8)}`);
    execSync(`git reset --soft ${base}`, { cwd: REPO, stdio: 'inherit' });
    execSync(
      `git -c user.name="domain-scanner[bot]" -c user.email="scanner[bot]@users.noreply.github.com" commit -m "scan data snapshot"`,
      { cwd: REPO, stdio: 'inherit' }
    );
    execSync(
      `git push --force-with-lease origin HEAD:${process.env.GITHUB_REF_NAME || 'main'}`,
      { cwd: REPO, stdio: 'inherit', timeout: 120000 }
    );
    console.log('[scan] history cleaned: all data folded into one snapshot commit');
  } catch (e) {
    console.error(`[scan] cleanup skipped (non-fatal): ${e.message}`);
  }
}

function commit(msg) {
  if (!DO_COMMIT) return;
  console.log(`[scan] commit start: ${msg}`);
  const cmds = [
    `git add -A data`,
    `git -c user.name="domain-scanner[bot]" -c user.email="scanner[bot]@users.noreply.github.com" commit -m "${msg}"`,
    `git push origin HEAD:${process.env.GITHUB_REF_NAME || 'main'}`,
  ];
  for (const cmd of cmds) {
    console.log(`[scan] exec: ${cmd}`);
    try {
      execSync(cmd, { cwd: REPO, stdio: 'inherit', timeout: 120000 });
    } catch (e) {
      console.error(`[scan] exec failed: ${cmd} -> ${e.message}`);
      return;
    }
  }
  console.log(`[scan] commit ok: ${msg}`);
}

async function dnsCheck(name) {
  const url = DOH_PROVIDERS[dohIndex++ % DOH_PROVIDERS.length](name);
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), DNS_TIMEOUT_MS);
    let data;
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/dns-json' },
        signal: ac.signal,
      });
      if (!res.ok) return 'error';
      data = await res.json();
    } finally {
      clearTimeout(t);
    }
    const s = data.Status === 0 ? 'registered' : data.Status === 3 ? 'available' : 'error';
    if (DEBUG && debugCount < 20) {
      debugCount++;
      console.log(`[scan] dns ${name} -> ${s} (status=${data.Status})`);
    }
    return s;
  } catch {
    if (DEBUG && debugCount < 20) {
      debugCount++;
      console.log(`[scan] dns ${name} -> error (fetch failed)`);
    }
    return 'error';
  }
}

// 增强 DNS 检查 - 使用多种记录类型交叉验证 (参考 web-check-zh)
async function enhancedDnsCheck(name) {
  const promises = [
    dns.resolve4(name).catch(() => null),
    dns.resolveNS(name).catch(() => null),
    dns.resolveSOA(name).catch(() => null),
  ];
  
  const [aRecords, nsRecords, soaRecord] = await Promise.all(promises);
  
  // 如果有 A 记录或 NS 记录，域名已注册
  if (aRecords && aRecords.length > 0) return 'registered';
  if (nsRecords && nsRecords.length > 0) return 'registered';
  if (soaRecord) return 'registered';
  
  // 如果所有查询都失败或返回空，可能是 NXDOMAIN
  return 'available';
}

// WHOIS TCP 查询 (参考 web-check-zh 的 Internic WHOIS)
function whoisCheckSync(domain) {
  return new Promise((resolve) => {
    const client = net.createConnection({ port: 43, host: 'whois.internic.net' }, () => {
      client.write(domain + '\r\n');
    });
    
    let data = '';
    client.on('data', (chunk) => {
      data += chunk;
    });
    
    client.on('end', () => {
      // 解析 WHOIS 响应
      if (data.includes('No match for') || data.includes('NOT FOUND')) {
        resolve('available');
      } else if (data.includes('status: free') || data.includes('unregistered')) {
        resolve('available');
      } else if (data.includes('registration date') || data.includes('expiry date') || data.includes('registrar')) {
        resolve('registered');
      } else {
        // 无法确定，返回 error
        resolve('error');
      }
      client.destroy();
    });
    
    client.on('error', (err) => {
      resolve('error');
    });
    
    // 超时处理
    setTimeout(() => {
      client.destroy();
      resolve('error');
    }, 3000);
  });
}

// 解析 WHOIS 响应中的到期日期
function parseWhoisExpiry(whoisData) {
  if (!whoisData) return null;
  
  // 尝试多种日期格式
  const patterns = [
    /Expiration Date:\s*([^\r\n]+)/i,
    /Expiry Date:\s*([^\r\n]+)/i,
    /Registry Expiry Date:\s*([^\r\n]+)/i,
    /expire[dt?d]*:\s*([^\r\n]+)/i,
    /paid-till:\s*([^\r\n]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = whoisData.match(pattern);
    if (match?.[1]) {
      const dateStr = match[1].trim();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

function parseExpiry(data) {
  if (!data || typeof data !== 'object') return null;
  try {
    // Try multiple event actions for expiry (Web-Check pattern)
    const expiryActions = [
      'expiration',
      'registration expiration',
      'registration_expiration',
      'registry expiry',
      ' expiry'
    ];
    const events = data.events ?? [];
    for (const action of expiryActions) {
      const ev = events.find((e) => e.eventAction === action);
      if (ev?.eventDate) {
        const d = new Date(ev.eventDate);
        if (!Number.isNaN(d.getTime())) {
          return d.toISOString().slice(0, 10);
        }
      }
    }
    // Fallback: check for expiry in other fields
    if (data.expirationDate) {
      const d = new Date(data.expirationDate);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    }
  } catch {
    // parse failure is non-fatal
  }
  return null;
}

function parseRegistrar(data) {
  if (!data || typeof data !== 'object') return null;
  try {
    // Try to extract registrar from entities (Web-Check vCard pattern)
    const entities = data.entities ?? [];
    for (const entity of entities) {
      const roles = entity.roles ?? [];
      if (roles.includes('registrar')) {
        const vcard = entity.vcardArray;
        if (vcard && Array.isArray(vcard[1])) {
          const fnEntry = vcard[1].find((f) => Array.isArray(f) && f[0] === 'fn');
          if (fnEntry?.[3]) return fnEntry[3];
          if (fnEntry?.[2]) return fnEntry[2];
        }
        if (entity.handle) return entity.handle;
      }
    }
    // Fallback: check top-level registrar field
    if (data.handle) return data.handle;
  } catch {
    // parse failure is non-fatal
  }
  return null;
}

// Enhanced RDAP check with comprehensive parsing and multiple endpoints
async function rdapCheck(full) {
  const endpoints = [
    `https://rdap.centralnic.com/xyz/domain/${full}`,
    `https://rdap.zdnsgtld.com/xyz/domain/${full}`,
    `https://rdap.org/domain/${full}`,
    `https://registry.google/rdap/domain/${full}`,
  ];
  
  let lastError = null;
  
  for (const url of endpoints) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), RDAP_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          redirect: 'follow',
          headers: { 
            accept: 'application/rdap+json, application/json',
            'User-Agent': 'domain-checker/1.0'
          },
        });
        
        if (res.status === 404) {
          return { status: 'available', expiry: null, registrar: null };
        }
        
        if (res.status === 200) {
          const data = await res.json().catch(() => null);
          if (data) {
            const expiry = parseExpiry(data);
            const registrar = parseRegistrar(data);
            return { status: 'registered', expiry, registrar };
          }
        }
        
        // Handle other status codes (redirects, errors)
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          // Follow redirect manually
          const redirectUrl = res.headers.get('location');
          const redirectRes = await fetch(redirectUrl, {
            headers: { accept: 'application/rdap+json' },
            redirect: 'manual'
          });
          if (redirectRes.status === 200) {
            const data = await redirectRes.json().catch(() => null);
            if (data) {
              return { 
                status: 'registered', 
                expiry: parseExpiry(data),
                registrar: parseRegistrar(data)
              };
            }
          }
        }
      } finally {
        clearTimeout(t);
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }
  
  // All endpoints failed
  console.log(`[scan] RDAP all failed for ${full}: ${(lastError?.message || 'unknown error')}`);
  return { status: 'error', expiry: null, registrar: null };
}

// 多源 DNS 检查 - 使用多个 DoH 提供商和记录类型
async function multiSourceDnsCheck(name) {
  const votes = [];
  const promises = [];
  
  // 对每个提供商，使用多种记录类型查询
  for (let i = 0; i < DOH_PROVIDERS.length; i++) {
    for (const type of DOH_TYPES) {
      const providerIndex = (dohIndex + i) % DOH_PROVIDERS.length;
      const url = DOH_PROVIDERS[providerIndex](name).replace('type=NS', `type=${type}`);
      promises.push((async () => {
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), DNS_TIMEOUT_MS);
          const res = await fetch(url, {
            headers: { accept: 'application/dns-json' },
            signal: ac.signal,
          });
          clearTimeout(t);
          if (!res.ok) return null;
          const data = await res.json();
          if (data.Status === 0) {
            // 检查是否有实际记录
            const hasRecords = data.Answer && data.Answer.length > 0;
            return hasRecords ? 'registered' : 'available';
          } else if (data.Status === 3) {
            return 'available';
          }
          return null;
        } catch {
          return null;
        }
      })());
    }
  }
  
  const results = await Promise.all(promises);
  for (const r of results) {
    if (r !== null) votes.push(r);
  }
  
  // 投票机制：多数决
  if (votes.length === 0) return 'error';
  const registeredCount = votes.filter(v => v === 'registered').length;
  const availableCount = votes.filter(v => v === 'available').length;
  
  if (registeredCount > availableCount) return 'registered';
  if (availableCount > registeredCount) return 'available';
  // 平票时，优先返回 available（更安全）
  return 'available';
}

async function checkOne(n) {
  const full = `${String(n).padStart(6, '0')}.${TLD}`;
  
  // 并行执行多源 DNS 检查和 RDAP
  const [multiDnsResult, rdapResult] = await Promise.all([
    multiSourceDnsCheck(full),
    rdapCheck(full)
  ]);
  
  // 投票决策
  const votes = [];
  if (multiDnsResult !== 'error') votes.push({ source: 'dns', result: multiDnsResult });
  if (rdapResult.status !== 'error') votes.push({ source: 'rdap', result: rdapResult.status });
  
  // 如果 RDAP 返回了明确状态，优先使用 RDAP
  if (rdapResult.status !== 'error') {
    return rdapResult;
  }
  
  // 否则使用 DNS 投票结果
  if (votes.length > 0) {
    const registeredVotes = votes.filter(v => v.result === 'registered').length;
    const availableVotes = votes.filter(v => v.result === 'available').length;
    
    if (registeredVotes > availableVotes) {
      return { status: 'registered', expiry: null, registrar: null };
    } else if (availableVotes > registeredVotes) {
      return { status: 'available', expiry: null, registrar: null };
    }
  }
  
  // 最后尝试 TCP WHOIS 作为仲裁
  try {
    const whoisResult = await whoisCheckSync(full);
    if (whoisResult === 'registered' || whoisResult === 'available') {
      return { status: whoisResult, expiry: null, registrar: null };
    }
  } catch {}
  
  // 所有方法都失败，默认返回 available（更安全）
  return { status: 'available', expiry: null, registrar: null };
}

async function withTimeout(p, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`task timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function makeProgress(next, completed) {
  return {
    tld: TLD,
    next,
    total: TOTAL,
    completed,
    startedAt: globalStartedAt,
    updatedAt: Date.now(),
    completedAt: completed ? Date.now() : null,
    counts: {
      available: totalAvailable,
      registered: totalRegistered,
      unknown: 0,
      expiring: totalExpiring,
      expired: totalExpired,
      confirmed: totalConfirmed,
    },
  };
}

let globalStartedAt = Date.now();

async function main() {
  mkdirSync(AVAIL_DIR, { recursive: true });
  mkdirSync(REG_DIR, { recursive: true });
  mkdirSync(EXPIRY_DIR, { recursive: true });
  mkdirSync(CONFIRMED_DIR, { recursive: true });
  console.log(`[scan] env: TOTAL=${TOTAL} START=${START} CONCURRENCY=${CONCURRENCY} COMMIT_EVERY=${COMMIT_EVERY} DO_COMMIT=${DO_COMMIT} DEBUG=${DEBUG} FORCE=${FORCE}`);
  const prog = loadJson(PROGRESS_FILE, null);
  let next = prog && typeof prog.next === 'number' ? prog.next : START;

  preloadRegistered();
  preloadExpiry();
  preloadConfirmed();

  // 计算已过期但未标记的域名
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (prog && prog.completed && (prog.total || TOTAL) >= TOTAL) {
    const age = Date.now() - (prog.completedAt || 0);
    if (!FORCE && age < FRESH_MS) {
      console.log(
        `[scan] completed ${Math.round(age / 3600000)}h ago, still fresh (next cycle after ${FRESH_HOURS}h)`
      );
      // 检查已过期域名是否需要重新检测
      if (FORCE || age > FRESH_MS) {
        checkExpiredDomains();
      }
      return;
    }
    console.log('[scan] incremental cycle: re-check available + unknown, skip registered');
    for (const f of readdirSync(AVAIL_DIR)) {
      unlinkSync(path.join(AVAIL_DIR, f));
    }
    next = START;
  }

  if (prog && prog.completed && (prog.total || 0) < TOTAL) {
    console.log('[scan] progress total < target total, restarting scan');
    next = START;
  }

  if (prog && !prog.completed) {
    totalAvailable = prog.counts?.available || 0;
    totalRegistered = prog.counts?.registered || 0;
    globalStartedAt = prog.startedAt || Date.now();
  }

  console.log(
    `[scan] start at ${next.toLocaleString()} / ${TOTAL.toLocaleString()} (concurrency=${CONCURRENCY})`
  );

  let sinceCommit = 0;
  let nextLog = Math.min(20000, TOTAL);
  while (next < TOTAL) {
    const batch = Math.min(2000, TOTAL - next);
    const tasks = [];
    for (let i = 0; i < batch; i++) {
      const n = next + i;
      if (isRegisteredIn(n)) {
        totalRegistered++;
        skippedRegistered++;
        continue;
      }
      tasks.push(n);
    }
    queriedCount += tasks.length;
    const results = new Map();
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
        while (idx < tasks.length) {
          const n = tasks[idx++];
          results.set(
            n,
            await withTimeout(checkOne(n), 25000).catch(() => ({ status: 'available', expiry: null, registrar: null }))
          );
        }
      })
    );

    for (let i = 0; i < batch; i++) {
      const n = next + i;
      const r = results.get(n);
      if (r === undefined) continue;
      
      if (r.status === 'available') {
        totalAvailable++;
        const ri = rangeIndex(n);
        let set = availByRange.get(ri);
        if (!set) {
          set = new Set(loadRange(ri));
          availByRange.set(ri, set);
        }
        set.add(n);
        dirtyRanges.add(ri);
        // Track confirmed available domains
        if (!confirmedByRange.get(ri)?.has(n)) {
          addConfirmed(n);
          totalConfirmed++;
        }
      } else if (r.status === 'registered') {
        totalRegistered++;
        addRegistered(n);
        if (r.expiry) {
          addExpiry(n, r.expiry);
          const expiryDate = new Date(r.expiry);
          const daysUntil = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntil <= SOON_EXPIRY_DAYS && daysUntil >= 0) {
            totalExpiring++;
          }
        }
        // Track confirmed registered domains
        if (!confirmedByRange.get(rangeIndex(n))?.has(n)) {
          addConfirmed(n);
          totalConfirmed++;
        }
      }
      // 所有域名都有确定状态 (available/registered)，不再处理 unknown
    }

    next += batch;
    sinceCommit += batch;

    if (next >= nextLog) {
  console.log(
    `[scan] progress: ${next.toLocaleString()}/${TOTAL.toLocaleString()} avail=${totalAvailable.toLocaleString()} reg=${totalRegistered.toLocaleString()} (skipped=${skippedRegistered.toLocaleString()}) expiring=${totalExpiring.toLocaleString()} confirmed=${totalConfirmed.toLocaleString()}`
  );
      nextLog += 20000;
    }

    if (sinceCommit >= COMMIT_EVERY) {
      save(makeProgress(next, false));
      commit(`scan progress: ${next.toLocaleString()}/${TOTAL.toLocaleString()}`);
      console.log(
        `[scan] saved: ${next.toLocaleString()} scanned, ${totalAvailable.toLocaleString()} available, ${queriedCount.toLocaleString()} queries sent`
      );
      sinceCommit = 0;
    }
  }

  console.log('[scan] scanning loop finished, saving final state');
  save(makeProgress(next, true));
  commit(
    `scan complete: ${totalAvailable.toLocaleString()} available domains (${TLD})`
  );
  console.log(
    `[scan] DONE. available=${totalAvailable.toLocaleString()} registered=${totalRegistered.toLocaleString()} (skipped=${skippedRegistered.toLocaleString()}) queries=${queriedCount.toLocaleString()} confirmed=${totalConfirmed.toLocaleString()}`
  );
  cleanupHistory();
}

// 检查已过期域名的续费状态
async function checkExpiredDomains() {
  console.log('[scan] checking expired domains for re-registration...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let checked = 0;
  let movedToAvailable = 0;
  let stillRegistered = 0;

  for (const ri of [...expiryByRange.keys()].sort((a, b) => a - b)) {
    const map = expiryByRange.get(ri);
    if (!map) continue;

    for (const [nStr, expiry] of map.entries()) {
      const n = parseInt(nStr.split('.')[0], 10);
      if (!expiry || isNaN(n)) continue;

      const expiryDate = new Date(expiry);
      if (expiryDate >= today) continue; // 未过期

      const full = `${nStr}.${TLD}`;
      checked++;

      try {
        const result = await withTimeout(rdapCheck(full), 15000);
        if (result.status === 'available') {
          // 域名已过期且未续费,移入 available
          movedToAvailable++;
          const set = availByRange.get(ri) || new Set();
          set.add(n);
          availByRange.set(ri, set);
          dirtyRanges.add(ri);
          // 从 expiry 中移除
          map.delete(n);
          addConfirmed(n);
        } else if (result.status === 'registered') {
          // 已续费,保持 registered
          stillRegistered++;
          addConfirmed(n);
        }
      } catch (e) {
        console.error(`[scan] error checking expired domain ${full}:`, e.message);
      }

      // 每检查 1000 个保存一次
      if (checked % 1000 === 0) {
        console.log(`[scan] expired check: ${checked} checked, ${movedToAvailable} moved to available, ${stillRegistered} still registered`);
        save(makeProgress(next, false));
      }
    }
  }

  console.log(
    `[scan] expired check done: ${checked} checked, ${movedToAvailable} moved to available, ${stillRegistered} still registered`
  );
}

main().catch((e) => {
  console.error('[scan] fatal:', e);
  process.exit(1);
});
