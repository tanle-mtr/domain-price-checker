import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedPrice {
  registrar: string;
  firstYear: number | null;
  renewal: number | null;
  currency: string;
  source: string;
  rawPrice?: string;
  scrapedAt: number;
  success: boolean;
  error?: string;
}

/**
 * 从网页中提取价格
 */
function extractPrice(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1].replace(/[,]/g, ''));
      if (!isNaN(num) && num > 0 && num < 1000) {
        return num;
      }
    }
  }
  return null;
}

/**
 * Cloudflare 域名价格爬虫
 */
async function scrapeCloudflare(tld: string): Promise<ScrapedPrice> {
  try {
    // Cloudflare 价格页面
    const res = await axios.get(`https://domains.cloudflare.com/pricing/${tld}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    
    const text = res.data;
    // 尝试提取价格
    const pricePatterns = [
      /\$([0-9,]+\.[0-9]{2})/i,
      /([0-9,]+\.[0-9]{2})\s*USD/i,
    ];
    
    const firstYear = extractPrice(text, pricePatterns);
    
    return {
      registrar: 'Cloudflare',
      firstYear,
      renewal: firstYear, // Cloudflare 首年续费同价
      currency: 'USD',
      source: 'cloudflare',
      scrapedAt: Date.now(),
      success: true,
    };
  } catch (e) {
    return {
      registrar: 'Cloudflare',
      firstYear: null,
      renewal: null,
      currency: 'USD',
      source: 'cloudflare',
      scrapedAt: Date.now(),
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Porkbun 域名价格爬虫
 */
async function scrapePorkbun(tld: string): Promise<ScrapedPrice> {
  try {
    const res = await axios.get(`https://porkbun.com/whois/${tld}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    
    const text = res.data;
    const pricePatterns = [
      /\$([0-9,]+\.[0-9]{2})/i,
      /([0-9,]+\.[0-9]{2})\s*USD/i,
    ];
    
    const firstYear = extractPrice(text, pricePatterns);
    
    return {
      registrar: 'Porkbun',
      firstYear,
      renewal: firstYear,
      currency: 'USD',
      source: 'porkbun',
      scrapedAt: Date.now(),
      success: true,
    };
  } catch (e) {
    return {
      registrar: 'Porkbun',
      firstYear: null,
      renewal: null,
      currency: 'USD',
      source: 'porkbun',
      scrapedAt: Date.now(),
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Namecheap 域名价格爬虫
 */
async function scrapeNamecheap(tld: string): Promise<ScrapedPrice> {
  try {
    const res = await axios.get(`https://www.namecheap.com/domains/registration/results/?domain=${tld}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    
    const text = res.data;
    const pricePatterns = [
      /\$([0-9,]+\.[0-9]{2})/i,
      /([0-9,]+\.[0-9]{2})\s*USD/i,
    ];
    
    const firstYear = extractPrice(text, pricePatterns);
    
    return {
      registrar: 'Namecheap',
      firstYear,
      renewal: null,
      currency: 'USD',
      source: 'namecheap',
      scrapedAt: Date.now(),
      success: true,
    };
  } catch (e) {
    return {
      registrar: 'Namecheap',
      firstYear: null,
      renewal: null,
      currency: 'USD',
      source: 'namecheap',
      scrapedAt: Date.now(),
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 阿里云域名价格爬虫
 */
async function scrapeAliyun(tld: string): Promise<ScrapedPrice> {
  try {
    // 阿里云域名查询页面
    const res = await axios.get(`https://wanwang.aliyun.com/domain/?keyword=${tld}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
    });
    
    const text = res.data;
    // 阿里云价格格式: ¥数字 或 ¥数字.数字
    const pricePatterns = [
      /¥([0-9,]+\.[0-9]{2})/i,
      /¥([0-9,]+)/i,
    ];
    
    const firstYear = extractPrice(text, pricePatterns);
    
    return {
      registrar: '阿里云',
      firstYear: firstYear ? firstYear / 7 : null, // 转换为 USD 估算
      renewal: null,
      currency: 'USD',
      source: 'aliyun',
      scrapedAt: Date.now(),
      success: true,
    };
  } catch (e) {
    return {
      registrar: '阿里云',
      firstYear: null,
      renewal: null,
      currency: 'USD',
      source: 'aliyun',
      scrapedAt: Date.now(),
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * 批量抓取多个注册商的价格
 */
export async function scrapePrices(tld: string): Promise<ScrapedPrice[]> {
  const results = await Promise.allSettled([
    scrapeCloudflare(tld),
    scrapePorkbun(tld),
    scrapeNamecheap(tld),
    scrapeAliyun(tld),
  ]);
  
  return results
    .filter((r): r is PromiseFulfilledResult<ScrapedPrice> => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * 获取缓存的价格（简化版，实际生产环境应该用 Redis）
 */
const priceCache = new Map<string, { data: ScrapedPrice[]; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1小时缓存

export function getCachedPrices(tld: string): ScrapedPrice[] | null {
  const cached = priceCache.get(tld);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

export function setCachedPrices(tld: string, data: ScrapedPrice[]): void {
  priceCache.set(tld, { data, timestamp: Date.now() });
}
