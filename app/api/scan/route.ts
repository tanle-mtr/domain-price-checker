import { NextResponse } from "next/server";
import { fastScanAvailability } from "@/lib/fastscan";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_COUNT = 1000;
const MAX_CONCURRENCY = 100;
const DEADLINE_MS = 48000;

export async function POST(req: Request) {
  let body: {
    start?: unknown;
    count?: unknown;
    concurrency?: unknown;
    tld?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    // 忽略解析失败
  }

  const start = Math.max(
    0,
    Math.min(999999, Math.floor(Number(body.start) || 0))
  );
  const count = Math.max(
    1,
    Math.min(MAX_COUNT, Math.floor(Number(body.count) || 200))
  );
  const concurrency = Math.max(
    1,
    Math.min(MAX_CONCURRENCY, Math.floor(Number(body.concurrency) || 50))
  );
  const tld = String(body.tld || "xyz").toLowerCase().replace(/^\./, "");

  const deadline = Date.now() + DEADLINE_MS;
  const end = Math.min(start + count, 1000000);

  const available: string[] = [];
  let registered = 0;
  let unknown = 0;

  const tasks: (() => Promise<void>)[] = [];
  for (let n = start; n < end && Date.now() < deadline; n++) {
    const name = String(n).padStart(6, "0");
    tasks.push(async () => {
      const status = await fastScanAvailability(name, tld);
      if (status === "available") available.push(`${name}.${tld}`);
      else if (status === "registered") registered++;
      else unknown++;
    });
  }

  let i = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (i < tasks.length) {
        const task = tasks[i++];
        await task();
      }
    }
  );
  await Promise.all(workers);

  return NextResponse.json({
    start,
    completed: tasks.length,
    next: start + tasks.length,
    tld,
    available,
    registered,
    unknown,
    stats: {
      checked: tasks.length,
      available: available.length,
      registered,
      unknown,
    },
  });
}