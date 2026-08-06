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
const PROGRESS_FILE = path.join(DATA, 'scan-progress.json');

const TLD = process.env.SCAN_TLD || 'xyz';
const TOTAL = Number(process.env.SCAN_TOTAL || 1000000);
const START = Number(process.env.SCAN_START || 0);
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 150);
const COMMIT_EVERY = Number(process.env.COMMIT_EVERY || 100000);
const DO_COMMIT = process.env.COMMIT === '1';
const DEBUG = process.env.SCAN_DEBUG === '1';
const FRESH_MS = 24 * 3600 * 1000;
const DNS_TIMEOUT_MS = 1500;
const RDAP_TIMEOUT_MS = 4000;
const RANGE = 100000;

let dohIndex = 0;
const DOH_PROVIDERS = [
  (name) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=NS`,
  (name) =>
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=NS`,
];

let totalAvailable = 0;
let totalRegistered = 0;
let totalUnknown = 0;
const availByRange = new Map();
const dirtyRanges = new Set();
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

function loadRange(ri) {
  const f = rangeFile(ri);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => parseInt(line.split('.')[0], 10))
    .filter((n) => Number.isInteger(n));
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

async function rdapCheck(full) {
  for (const url of [
    `https://rdap.centralnic.com/xyz/domain/${full}`,
    `https://rdap.org/domain/${full}`,
  ]) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), RDAP_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          redirect: 'follow',
          headers: { accept: 'application/rdap+json, application/json' },
        });
        if (res.status === 404) return 'available';
        if (res.status === 200) return 'registered';
      } finally {
        clearTimeout(t);
      }
    } catch {
      // 下一个端点
    }
  }
  return 'error';
}

async function checkOne(n) {
  const full = `${String(n).padStart(6, '0')}.${TLD}`;
  const s = await dnsCheck(full);
  if (s !== 'error') return s;
  return rdapCheck(full);
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
      unknown: totalUnknown,
    },
  };
}

let globalStartedAt = Date.now();

async function main() {
  mkdirSync(AVAIL_DIR, { recursive: true });
  console.log(`[scan] env: TOTAL=${TOTAL} START=${START} CONCURRENCY=${CONCURRENCY} COMMIT_EVERY=${COMMIT_EVERY} DO_COMMIT=${DO_COMMIT} DEBUG=${DEBUG}`);
  const prog = loadJson(PROGRESS_FILE, null);
  let next = prog && typeof prog.next === 'number' ? prog.next : START;

  if (prog && prog.completed && (prog.total || TOTAL) >= TOTAL) {
    const age = Date.now() - (prog.completedAt || 0);
    if (age < FRESH_MS) {
      console.log(
        `[scan] completed ${Math.round(age / 3600000)}h ago, still fresh (next cycle after 24h)`
      );
      return;
    }
    console.log('[scan] completed >24h ago, restarting full cycle');
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
    totalUnknown = prog.counts?.unknown || 0;
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
    for (let i = 0; i < batch; i++) tasks.push(next + i);
    const results = new Array(batch);
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
        while (idx < tasks.length) {
          const n = tasks[idx++];
          results[n - next] = await checkOne(n);
        }
      })
    );

    for (let i = 0; i < batch; i++) {
      const n = next + i;
      const s = results[i];
      if (s === 'available') {
        totalAvailable++;
        const ri = rangeIndex(n);
        let set = availByRange.get(ri);
        if (!set) {
          set = new Set(loadRange(ri));
          availByRange.set(ri, set);
        }
        set.add(n);
        dirtyRanges.add(ri);
      } else if (s === 'registered') {
        totalRegistered++;
      } else {
        totalUnknown++;
      }
    }

    next += batch;
    sinceCommit += batch;

    if (next >= nextLog) {
      console.log(
        `[scan] progress: ${next.toLocaleString()}/${TOTAL.toLocaleString()} avail=${totalAvailable.toLocaleString()} reg=${totalRegistered.toLocaleString()} unk=${totalUnknown.toLocaleString()}`
      );
      nextLog += 20000;
    }

    if (sinceCommit >= COMMIT_EVERY) {
      save(makeProgress(next, false));
      commit(`scan progress: ${next.toLocaleString()}/${TOTAL.toLocaleString()}`);
      console.log(
        `[scan] saved: ${next.toLocaleString()} scanned, ${totalAvailable.toLocaleString()} available`
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
    `[scan] DONE. available=${totalAvailable.toLocaleString()} registered=${totalRegistered.toLocaleString()} unknown=${totalUnknown.toLocaleString()}`
  );
}

main().catch((e) => {
  console.error('[scan] fatal:', e);
  process.exit(1);
});
