import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

export interface ScraperConfig {
  name: string;
  url: string;
  patterns: RegExp[];
  currency: 'USD' | 'CNY';
  fallbackPrice?: number;
}

export const PRICE_SCRAPERS: ScraperConfig[] = [
  {
    name: 'Cloudflare',
    url: 'https://domains.cloudflare.com/pricing',
    patterns: [/\$(\d+\.?\d*)\s*\/\s*year/i],
    currency: 'USD',
    fallbackPrice: 9.15,
  },
  {
    name: 'Porkbun',
    url: 'https://porkbun.com/',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
    fallbackPrice: 8.97,
  },
  {
    name: 'Namecheap',
    url: 'https://www.namecheap.com/domains/registration/results/?domain={tld}',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
    fallbackPrice: 8.88,
  },
  {
    name: 'GoDaddy',
    url: 'https://www.godaddy.com/domains/{tld}-prices',
    patterns: [/\$(\d+\.?\d*)/i],
    currency: 'USD',
    fallbackPrice: 11.99,
  },
  {
    name: 'Aliyun',
    url: 'https://wanwang.aliyun.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
    fallbackPrice: 55,
  },
  {
    name: 'Tencent',
    url: 'https://cloud.tencent.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
    fallbackPrice: 50,
  },
  {
    name: 'West.cn',
    url: 'https://www.west.cn/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
    fallbackPrice: 48,
  },
  {
    name: 'Xinnet',
    url: 'https://www.xinnet.com/domain/{tld}',
    patterns: [/¥(\d+\.?\d*)/i],
    currency: 'CNY',
    fallbackPrice: 52,
  },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
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
      source: 'scraped' | 'fallback';
    };
  };
  updatedAt: number;
}

type PriceCache = Record<string, CacheEntry>;

const CACHE_FILE = join(process.cwd(), 'data', 'prices', 'cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

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

async function scrapeRegistrarPrice(domain: string, tld: string, scraper: ScraperConfig): Promise<{ price: number | null; success: boolean; source: 'scraped' | 'fallback' }> {
  const url = scraper.url.replace('{tld}', tld);
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await axios.get(url, {
        headers: HEADERS,
        timeout: 10000,
        maxRedirects: 3,
        signal: controller.signal,
        validateStatus: (status) => status < 500,
      });
      
      clearTimeout(timeoutId);
      
      if (res.status >= 400 && res.status < 500) {
        console.log(`[Scrape] ${scraper.name}: HTTP ${res.status}, using fallback`);
        break;
      }
      
      const text = res.data;
      for (const pattern of scraper.patterns) {
        const match = text.match(pattern);
        if (match) {
          const price = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(price) && price > 0 && price < 1000) {
            return { price, success: true, source: 'scraped' };
          }
        }
      }
      
      if (attempt === 3) {
        break;
      }
      
    } catch (error: any) {
      console.log(`[Scrape] ${scraper.name} attempt ${attempt}: ${error.code || error.message}`);
      
      if (attempt === 3) {
        break;
      }
    }
    
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  
  if (scraper.fallbackPrice) {
    return { price: scraper.fallbackPrice, success: true, source: 'fallback' };
  }
  
  return { price: null, success: false, source: 'fallback' };
}

export async function scrapeDomainPrices(domain: string, tld: string): Promise<{
  status: 'available' | 'registered';
  whoisChecked: boolean;
  prices: { registrar: string; price: number | null; currency: 'USD' | 'CNY'; success: boolean; source: 'scraped' | 'fallback' }[];
}> {
  const cache = loadPriceCache();
  const cacheKey = `${domain}.${tld}`;
  
  if (cache[cacheKey]) {
    const entry = cache[cacheKey];
    if (Date.now() - entry.updatedAt < CACHE_TTL) {
      return {
        status: entry.status,
        whoisChecked: entry.whoisChecked,
        prices: Object.entries(entry.prices).map(([registrar, info]) => ({
          registrar,
          price: info.price,
          currency: info.currency,
          success: info.success,
          source: info.source,
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
  
  const scrapes = Promise.all(PRICE_SCRAPERS.map(async (scraper) => {
    const { price, success, source } = await scrapeRegistrarPrice(domain, tld, scraper);
    result.prices[scraper.name] = {
      price,
      currency: scraper.currency,
      success,
      scrapedAt: Date.now(),
      source,
    };
    await new Promise(r => setTimeout(r, 300));
    return { registrar: scraper.name, price, currency: scraper.currency, success, source };
  }));
  
  const prices = await scrapes;
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

