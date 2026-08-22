import { NextResponse } from "next/server";
import { checkDomain } from "@/lib/rdap";
import { domainToASCII } from "node:url";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^[a-z0-9-]{2,24}$/;

export async function POST(req: Request) {
  let body: { name?: unknown; tlds?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // 忽略解析失败
  }

  let rawName = String(body.name ?? "").trim().toLowerCase().replace(/\.+$/, "");
  if (/[^\x00-\x7f]/.test(rawName)) {
    rawName = domainToASCII(rawName).toLowerCase();
  }
  if (!NAME_RE.test(rawName)) {
    return NextResponse.json({ error: "域名格式不正确" }, { status: 400 });
  }

  const tlds: string[] = Array.isArray(body.tlds)
    ? body.tlds.map((t) => String(t).toLowerCase().replace(/^\./, ""))
    : [];
  const uniqueTlds = [...new Set(tlds)]
    .filter((t) => TLD_RE.test(t))
    .slice(0, 40);

  if (uniqueTlds.length === 0) {
    return NextResponse.json(
      { error: "请至少选择一个域名后缀" },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    uniqueTlds.map((tld) => checkDomain(rawName, tld))
  );

  return NextResponse.json({ name: rawName, results });
}