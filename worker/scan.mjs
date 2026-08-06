import { Resolver } from 'node:dns/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.GITHUB_WORKSPACE || path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data');
const AVAIL_DIR = path.join(DATA, 'available');
const PROGRESS_FILE = path.join(DATA, 'scan-progress.json');

const TLD = process.env.SCAN_TLD || 'xyz';
const TOTAL = Number(process.env.SCAN_TOTAL || 1000000);
const START = Number(process.env.SCAN_START || 0);
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 150);
const COMMIT_EVERY = Number(process.env.COMMIT_EVERY || 50000);
const DO_COMMIT = process.env.COMMIT === '1';
const FRESH_MS = 24 * 3600 * 1000;
const DNS_TIMEOUT_MS = 2500;
const RDAP_TIMEOUT_MS = 4000;
const RANGE = 100000;

const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9']);

let totalAvailable = 0;
let totalRegistered = 0;
let totalUnknown = 0;
const availByRange = new Map();
const dirtyRanges = new Set();

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
  try {
    execSync('git add -A data', { cwd: REPO, stdio: 'inherit' });
    execSync(
      `git -c user.name="domain-scanner[bot]" -c user.email="scanner[bot]@users.noreply.github.com" commit -m "${msg}"`,
      { cwd: REPO, stdio: 'inherit' }
    );
    execSync(`git push origin HEAD:${process.env.GITHUB_REF_NAME || 'main'}`, {
      cwd: REPO,
      stdio: 'inherit',
    });
  } catch (e) {
    console.error('[scan] commit/push failed:', e.message);
  }
}

async function dnsCheck(name) {
  try {
    const recs = await Promise.race([
      resolver.resolveNs(name),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('dns timeout')), DNS_TIMEOUT_MS)
      ),
    ]);
    return recs.length > 0 ? 'registered' : 'available';
  } catch (e) {
    const c = e && e.code;
    if (
      c === 'ENOTFOUND' ||
      c === 'ENODATA' ||
      c === 'ENOTEMPTY' ||
      c === 'NXDOMAIN'
    ) {
      return 'available';
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
  const prog = loadJson(PROGRESS_FILE, null);
  let next = prog && typeof prog.next === 'number' ? prog.next : START;

  if (prog && prog.completed) {
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

    if (sinceCommit >= COMMIT_EVERY) {
      save(makeProgress(next, false));
      commit(`scan progress: ${next.toLocaleString()}/${TOTAL.toLocaleString()}`);
      console.log(
        `[scan] saved: ${next.toLocaleString()} scanned, ${totalAvailable.toLocaleString()} available`
      );
      sinceCommit = 0;
    }
  }

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