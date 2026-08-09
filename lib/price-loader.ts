import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface PriceData {
  [domain: string]: {
    status: 'available' | 'registered';
    whoisChecked: boolean;
    prices?: {
      [registrar: string]: {
        price: number | null;
        success: boolean;
      };
    };
  };
}

export interface ScrapingStats {
  totalScraped: number;
  lastRun: number;
  results: {
    [tld: string]: PriceData;
  };
}

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/tanle-mtr/domain-price-checker/main/data/prices';

/**
 * 从 GitHub 加载价格数据
 */
export async function loadPricesFromGitHub(tld: string): Promise<PriceData | null> {
  try {
    const res = await fetch(`${GITHUB_RAW_URL}/${tld}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 从本地缓存加载价格数据
 */
export function loadLocalPrices(tld: string): PriceData | null {
  try {
    const cacheFile = join(process.cwd(), 'data', 'prices', `${tld}.json`);
    if (!existsSync(cacheFile)) return null;
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 获取价格数据（优先 GitHub，回退本地）
 */
export async function fetchPrices(tld: string): Promise<PriceData | null> {
  // 先尝试 GitHub
  const github = await loadPricesFromGitHub(tld);
  if (github) return github;
  
  // 回退本地
  return loadLocalPrices(tld);
}
