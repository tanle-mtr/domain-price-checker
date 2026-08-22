import { NextResponse } from "next/server";
import { REGISTRARS } from "@/lib/pricing";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tld = searchParams.get("tld");
  
  if (!tld) {
    return NextResponse.json({ error: "缺少 tld 参数" }, { status: 400 });
  }

  try {
    const defaultPrices = REGISTRARS
      .filter(r => !r.excludeTlds?.includes(tld))
      .map(r => ({
        registrar: r.registrar,
        firstYear: r.firstYear,
        renewal: r.renewal,
        currency: r.cn ? 'CNY' : 'USD',
        source: 'default' as const,
        scrapedAt: 0,
        success: true,
      }));
    
    return NextResponse.json({ tld, prices: defaultPrices, fromCache: false, timestamp: Date.now() });
  } catch (error) {
    return NextResponse.json(
      { error: "获取价格失败", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
