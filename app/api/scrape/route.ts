import { NextResponse } from "next/server";
import { scrapePrices, getCachedPrices, setCachedPrices } from "@/lib/price-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { tld?: unknown; force?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tld = String(body.tld ?? "").toLowerCase().replace(/^\./, "");
  const force = body.force === true;

  if (!tld || tld.length < 2 || tld.length > 10) {
    return NextResponse.json({ error: "无效的 TLD" }, { status: 400 });
  }

  // 检查缓存
  if (!force) {
    const cached = getCachedPrices(tld);
    if (cached) {
      return NextResponse.json({ tld, prices: cached, fromCache: true });
    }
  }

  try {
    const prices = await scrapePrices(tld);
    setCachedPrices(tld, prices);
    return NextResponse.json({ tld, prices, fromCache: false });
  } catch (error) {
    return NextResponse.json(
      { error: "抓取价格失败", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tld = searchParams.get("tld");
  
  if (!tld) {
    return NextResponse.json({ error: "缺少 tld 参数" }, { status: 400 });
  }

  const cached = getCachedPrices(tld);
  if (cached) {
    return NextResponse.json({ tld, prices: cached, fromCache: true });
  }

  return NextResponse.json({ error: "缓存中无数据，请使用 POST 请求抓取" }, { status: 404 });
}
