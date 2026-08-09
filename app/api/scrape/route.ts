import { NextResponse } from "next/server";
import { scrapeDomainPrices, loadPriceCache } from "@/lib/price-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 价格爬虫 API
 * 
 * 工作流程�? * 1. 接收域名�?TLD
 * 2. 先进�?WHOIS 检查（RDAP/TCP WHOIS/DNS�? * 3. 只对可用域名进行价格爬虫
 * 4. 缓存结果�?data/prices/cache.json
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { domain, tld } = body;
    
    if (!domain || !tld) {
      return NextResponse.json(
        { error: "缺少 domain �?tld 参数" },
        { status: 400 }
      );
    }
    
    // 调用爬虫
    const result = await scrapeDomainPrices(domain, tld);
    
    return NextResponse.json({
      domain,
      tld,
      status: result.status,
      whoisChecked: result.whoisChecked,
      prices: result.prices,
      cache: loadPriceCache(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "爬虫失败", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * 查询缓存状�? */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");
  const tld = searchParams.get("tld");
  
  if (domain && tld) {
    const cache = loadPriceCache();
    const key = `${domain}.${tld}`;
    const entry = cache[key];
    
    if (entry) {
      return NextResponse.json({
        cached: true,
        domain,
        tld,
        status: entry.status,
        whoisChecked: entry.whoisChecked,
        updatedAt: entry.updatedAt,
        prices: entry.prices,
      });
    }
  }
  
  return NextResponse.json({ cached: false });
}



