import { NextResponse } from "next/server";
import { scrapeDomainPrices, loadPriceCache } from "@/lib/price-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-static";

/**
 * Price scraper API
 * Workflow:
 * 1. Accept domain and TLD
 * 2. Check WHOIS first (RDAP/TCP WHOIS/DNS)
 * 3. Only scrape prices for available domains
 * 4. Cache results to data/prices/cache.json
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { domain, tld } = body;
    
    if (!domain || !tld) {
      return NextResponse.json(
        { error: "Missing domain or tld parameter" },
        { status: 400 }
      );
    }
    
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
      { error: "Scrape failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * Check cache status
 */
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

