import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

export interface ScraperConfig {
  name: string;
  url: string;
  patterns: RegExp[];
  currency: 'USD' | 'CNY';
}

export const PRICE_SCRAPERS: ScraperConfig[] = [
  {
    name: 'Cloudflare',
    url: 'https://domains.cloudflare.com/pricing',
    patterns: [/\$(\d+\.?\d*)\s*\/\s*year/i],
    currency: 'USD',
  },
  {
    name: 'Porkbun',
    url: 'https://porkbun.com/',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
  },
  {
    name: 'Namecheap',
    url: 'https://www.namecheap.com/domains/registration/results/?domain={tld}',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
  },
  {
    name: 'GoDaddy',
    url: 'https://www.godaddy.com/domains/{tld}-prices',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
  },
  {
    name: 'Aliyun',
    url: 'https://wanwang.aliyun.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
  },
  {
    name: 'Tencent',
    url: 'https://cloud.tencent.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
  },
  {
    name: 'West.cn',
    url: 'https://www.west.cn/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
  },
  {
    name: 'Xinnet',
    url: 'https://www.xinnet.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
  },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
};

interface CacheEntry {
  domain: string;
  tld: string;
  status: 'available' | 'registered';
  whoisChecked: boolean;
  prices: {
    [registrar: string]: {
      price: number | null;
      currency: 'USD' | 'CNY';
      success: boolean;
      scrapedAt: number;
    };
  };
  updatedAt: number;
}

type PriceCache = Record<string, CacheEntry>;

const CACHE_FILE = join(process.cwd(), 'data', 'prices', 'cache.json');

export function loadPriceCache(): PriceCache {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

export function savePriceCache(cache: PriceCache) {
  mkdirSync(join(process.cwd(), 'data', 'prices'), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function scrapeRegistrarPrice(domain: string, tld: string, scraper: ScraperConfig): Promise<{ price: number | null; success: boolean }> {
  const url = scraper.url.replace('{tld}', tld);
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 3,
    });
    const text = res.data;
    for (const pattern of scraper.patterns) {
      const match = text.match(pattern);
      if (match) {
        const price = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(price) && price > 0 && price < 1000) {
          return { price, success: true };
        }
      }
    }
    return { price: null, success: false };
  } catch (error: any) {
    console.error(`[Scrape] Failed ${scraper.name}: ${error.message}`);
    return { price: null, success: false };
  }
}

export async function scrapeDomainPrices(domain: string, tld: string): Promise<{
  status: 'available' | 'registered';
  whoisChecked: boolean;
  prices: { registrar: string; price: number | null; currency: 'USD' | 'CNY'; success: boolean }[];
}> {
  const cache = loadPriceCache();
  const cacheKey = `${domain}.${tld}`;
  
  if (cache[cacheKey]) {
    const entry = cache[cacheKey];
    if (Date.now() - entry.updatedAt < 3600000) {
      return {
        status: entry.status,
        whoisChecked: entry.whoisChecked,
        prices: Object.entries(entry.prices).map(([registrar, info]) => ({
          registrar,
          price: info.price,
          currency: info.currency,
          success: info.success,
        })),
      };
    }
  }
  
  const { checkDomain } = await import('@/lib/rdap');
  const availabilityResult = await checkDomain(domain, tld);
  
  const result: CacheEntry = {
    domain,
    tld,
    status: availabilityResult.status,
    whoisChecked: true,
    prices: {},
    updatedAt: Date.now(),
  };
  
  if (availabilityResult.status === 'registered') {
    savePriceCache({ ...cache, [cacheKey]: result });
    return {
      status: 'registered',
      whoisChecked: true,
      prices: [],
    };
  }
  
  const scrapes = PRICE_SCRAPERS.map(async (scraper) => {
    const { price, success } = await scrapeRegistrarPrice(domain, tld, scraper);
    result.prices[scraper.name] = {
      price,
      currency: scraper.currency,
      success,
      scrapedAt: Date.now(),
    };
    await new Promise(r => setTimeout(r, 500));
    return { registrar: scraper.name, price, currency: scraper.currency, success };
  });
  
  const prices = await Promise.all(scrapes);
  savePriceCache({ ...cache, [cacheKey]: result });
  
  return {
    status: 'available',
    whoisChecked: true,
    prices: prices.map(p => ({ ...p })),
  };
}

export async function scrapeDomainPricesBatch(domains: string[], tld: string): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  for (const domain of domains) {
    const result = await scrapeDomainPrices(domain, tld);
    results.set(domain, result);
  }
  return results;
}

