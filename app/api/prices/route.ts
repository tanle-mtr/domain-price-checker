import { NextResponse } from "next/server";
import { getPrices, refreshPrices, getCheapestPrice } from "@/lib/price-database";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: { tld?: unknown; refresh?: unknown; currency?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tld = String(body.tld ?? "").toLowerCase().replace(/^\./, "");
  const refresh = body.refresh === true;
  const currency = String(body.currency ?? "");

  if (!tld || tld.length < 2 || tld.length > 10) {
    return NextResponse.json({ error: "无效的 TLD" }, { status: 400 });
  }

  try {
    let prices;
    let message = "";
    
    if (refresh) {
      const result = await refreshPrices(tld);
      message = result.message;
      prices = getPrices(tld);
    } else {
      prices = getPrices(tld);
    }

    // 获取最便宜价格
    const cheapest = getCheapestPrice(tld, currency || undefined);

    return NextResponse.json({ 
      tld, 
      prices, 
      cheapest,
      message,
      timestamp: Date.now() 
    });
  } catch (error) {
    return NextResponse.json(
      { error: "获取价格失败", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tld = searchParams.get("tld");
  const currency = searchParams.get("currency");
  
  if (!tld) {
    return NextResponse.json({ error: "缺少 tld 参数" }, { status: 400 });
  }

  const prices = getPrices(tld);
  const cheapest = getCheapestPrice(tld, currency || undefined);
  
  return NextResponse.json({ tld, prices, cheapest, timestamp: Date.now() });
}
