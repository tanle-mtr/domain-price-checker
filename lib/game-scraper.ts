import axios from 'axios';
import * as cheerio from 'cheerio';

export interface PlatformPriceResult {
  platform: string;
  priceCents: number;
  originalPriceCents?: number;
  discount?: number;
  url: string;
  currency: string;
  success: boolean;
  error?: string;
}

export interface GameEntry {
  id: string;
  title: string;
  cover: string;
  tags: string[];
  releases: string;
  steamId?: number;
  epicSlug?: string;
  gogId?: string;
  platforms: ('steam' | 'epic' | 'gog' | 'humble' | 'fanatical' | 'gmgn')[];
}

// ─── CORS 代理回退（浏览器端抓取无 CORS 的站点）─────────────────────
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

async function fetchWithProxy(url: string, headers: Record<string, string> = {}) {
  for (const proxyFactory of CORS_PROXIES) {
    try {
      const res = await axios.get(proxyFactory(url), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        timeout: 12000,
      });
      return res.data;
    } catch {
      // 换下一个代理重试
    }
  }
  throw new Error('所有代理均失败');
}

// ─── Steam 爬虫（官方 API，无 CORS）────────────────────────────────
export async function scrapeSteam(appId: number): Promise<PlatformPriceResult> {
  try {
    const res = await axios.get(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=cn&l=chinese`,
      { timeout: 15000 }
    );
    const data = res.data[String(appId)];
    if (!data?.success) {
      return {
        platform: 'Steam',
        priceCents: 0,
        url: `https://store.steampowered.com/app/${appId}/`,
        currency: 'CNY',
        success: false,
        error: 'App 不存在',
      };
    }
    const pricing = data.data?.pricing_cycle?.[0] || {};
    const initial = pricing.initial || 0;
    const final = pricing.final || initial;
    const discount = initial > 0 ? Math.round(((initial - final) / initial) * 100) : 0;
    return {
      platform: 'Steam',
      priceCents: final,
      originalPriceCents: initial,
      discount: discount > 0 ? discount : undefined,
      url: `https://store.steampowered.com/app/${appId}/`,
      currency: 'CNY',
      success: true,
    };
  } catch (e) {
    return {
      platform: 'Steam',
      priceCents: 0,
      url: `https://store.steampowered.com/app/${appId}/`,
      currency: 'CNY',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── Epic Games 爬虫（GraphQL API）─────────────────────────────────
export async function scrapeEpic(slug: string): Promise<PlatformPriceResult> {
  try {
    const body = JSON.stringify({
      query: `
        query GetCatalogStore($slug: String!) {
          catalogStores(country: CN, language: zh) {
            catalogs(storeFrontId: "global") {
              elements(filter: {slug: $slug}, first: 1) {
                nodes {
                  title
                  items {
                    id
                    price {
                      totalPrice {
                        fmtPrice(locale: "CN")
                        priceWithoutVat {
                          discountContexts { discountType amount }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { slug },
    });

    const res = await axios.post(
      'https://graphql.epicgames.com/graphql',
      body,
      {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'EpicGamesAPI/1.0' },
        timeout: 15000,
      }
    );

    const data = res.data?.data?.catalogStores?.catalogs?.elements?.nodes?.[0];
    if (!data) {
      return {
        platform: 'Epic Games',
        priceCents: 0,
        url: `https://www.epicgames.com/store/product/${slug}`,
        currency: 'CNY',
        success: false,
        error: '未在 Epic 找到该游戏',
      };
    }

    const item = data.items?.[0];
    const priceStr = item?.price?.totalPrice?.fmtPrice?.['CN'] || '';
    const cents = parseInt((priceStr || '').replace(/[^\d]/g, ''), 10) || 0;
    const discountContexts = item?.price?.totalPrice?.priceWithoutVat?.discountContexts || [];
    const discount = discountContexts.some((d: any) => d.discountType === 'COMMERCIAL')
      ? Math.round(discountContexts.reduce((s: number, d: any) => s + (d.amount || 0), 0))
      : 0;

    return {
      platform: 'Epic Games',
      priceCents: cents,
      discount: discount > 0 ? discount : undefined,
      url: `https://www.epicgames.com/store/product/${slug}`,
      currency: 'CNY',
      success: cents > 0,
    };
  } catch (e) {
    return {
      platform: 'Epic Games',
      priceCents: 0,
      url: `https://www.epicgames.com/store/product/${slug}`,
      currency: 'CNY',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── GOG 爬虫 ───────────────────────────────────────────────────────
export async function scrapeGog(gogId: string): Promise<PlatformPriceResult> {
  try {
    const html = await fetchWithProxy(`https://www.gog.com/game/${gogId}`);
    const $ = cheerio.load(html);
    const text = $('[data-testid="product-price"], .price, [class*="price"]').first().text()
      || $('script[type="application/ld+json"]').first().text();
    const match = text.match(/[\d]+\.?\d*/);
    const cents = match ? parseFloat(match[0]) * 100 : 0;
    return {
      platform: 'GOG',
      priceCents: cents,
      url: `https://www.gog.com/game/${gogId}`,
      currency: 'CNY',
      success: cents > 0,
    };
  } catch (e) {
    return {
      platform: 'GOG',
      priceCents: 0,
      url: `https://www.gog.com/game/${gogId}`,
      currency: 'CNY',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── Humble Bundle 爬虫（官方 API）─────────────────────────────────
export async function scrapeHumble(query: string): Promise<PlatformPriceResult> {
  try {
    const res = await axios.get(
      'https://www.humblebundle.com/api/1/store/search',
      {
        params: { query, page: 1, limit: 5 },
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        timeout: 15000,
      }
    );
    const results = res.data?.response?.results || [];
    const found = results.find((i: any) => i.title.toLowerCase().includes(query.toLowerCase()));
    if (!found) {
      return {
        platform: 'Humble Bundle',
        priceCents: 0,
        url: 'https://www.humblebundle.com/',
        currency: 'USD',
        success: false,
        error: '未找到',
      };
    }
    const priceStr = found.price?.amount || found.sale_price?.amount || '';
    const cents = parseFloat(priceStr) * 100;
    const originalCents = cents > 0 && found.sale_price
      ? (found.price?.amount ? parseFloat(found.price.amount) * 100 : undefined)
      : undefined;
    const discount = originalCents && cents < originalCents
      ? Math.round(((originalCents - cents) / originalCents) * 100)
      : undefined;
    return {
      platform: 'Humble Bundle',
      priceCents: cents,
      originalPriceCents: originalCents,
      discount,
      url: `https://www.humblebundle.com/${found.slug || ''}`,
      currency: 'USD',
      success: cents > 0,
    };
  } catch (e) {
    return {
      platform: 'Humble Bundle',
      priceCents: 0,
      url: 'https://www.humblebundle.com/',
      currency: 'USD',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── Fanatical 爬虫 ────────────────────────────────────────────────
export async function scrapeFanatical(query: string): Promise<PlatformPriceResult> {
  try {
    const html = await fetchWithProxy(`https://www.fanatical.com/search?q=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const cards = $('.product-card, .product-item, [class*="product"], [class*="card"]');
    let cents = 0;
    cards.each((_i, el) => {
      const text = $(el).text();
      const m = text.match(/¥\s*(\d+)/);
      if (m && cents === 0) cents = parseInt(m[1], 10) * 100;
    });
    if (cents === 0) {
      const match = html.match(/"price"\s*:\s*"¥\s*(\d+)"/);
      if (match) cents = parseInt(match[1], 10) * 100;
    }
    return {
      platform: 'Fanatical',
      priceCents: cents,
      url: `https://www.fanatical.com/search?q=${encodeURIComponent(query)}`,
      currency: 'CNY',
      success: cents > 0,
    };
  } catch (e) {
    return {
      platform: 'Fanatical',
      priceCents: 0,
      url: `https://www.fanatical.com/search?q=${encodeURIComponent(query)}`,
      currency: 'CNY',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── Green Man Gaming 爬虫 ─────────────────────────────────────────
export async function scrapeGMGN(query: string): Promise<PlatformPriceResult> {
  try {
    const html = await fetchWithProxy(`https://www.greenmangaming.com/search?searchTerm=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    const text = $('body').text();
    const m = text.match(/£\s*(\d+(?:\.\d{2})?)/);
    const priceGbp = m ? parseFloat(m[1]) : 0;
    const cents = Math.round(priceGbp * 950);
    return {
      platform: 'Green Man Gaming',
      priceCents: cents,
      url: 'https://www.greenmangaming.com',
      currency: 'CNY',
      success: priceGbp > 0,
    };
  } catch (e) {
    return {
      platform: 'Green Man Gaming',
      priceCents: 0,
      url: 'https://www.greenmangaming.com',
      currency: 'CNY',
      success: false,
      error: e instanceof Error ? e.message : 'Unknown',
    };
  }
}

// ─── localStorage 缓存（30 分钟有效期）──────────────────────────────
const CACHE_KEY_PREFIX = 'gpcache_';
const CACHE_TTL = 30 * 60 * 1000;

export interface CachedResult {
  prices: PlatformPriceResult[];
  timestamp: number;
}

export function getCache(key: string): CachedResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!raw) return null;
    const cached: CachedResult = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export function setCache(key: string, data: CachedResult): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(data));
  } catch { /* 忽略 */ }
}

// ─── 游戏目录（id → 各平台 ID）─────────────────────────────────────
export const GAME_CATALOG: Record<string, GameEntry> = {
  'elden-ring': {
    id: 'elden-ring',
    title: 'Elden Ring',
    cover: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&h=280&fit=crop',
    tags: ['RPG', '开放世界', '动作'],
    releases: '2022-02-25',
    steamId: 1245620,
    epicSlug: 'elden-ring',
    gogId: 'elden_ring',
    platforms: ['steam', 'epic', 'gog', 'humble', 'fanatical', 'gmgn'],
  },
  'cyberpunk-2077': {
    id: 'cyberpunk-2077',
    title: 'Cyberpunk 2077',
    cover: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=200&h=280&fit=crop',
    tags: ['RPG', '科幻', '开放世界'],
    releases: '2020-12-10',
    steamId: 1091500,
    gogId: 'cyberpunk_2077',
    platforms: ['steam', 'gog', 'humble', 'fanatical'],
  },
  'red-dead-redemption-2': {
    id: 'red-dead-redemption-2',
    title: 'Red Dead Redemption 2',
    cover: 'https://images.unsplash.com/photo-1534423861386-85d1805745c9?w=200&h=280&fit=crop',
    tags: ['动作', '冒险', '开放世界'],
    releases: '2018-10-26',
    steamId: 1174180,
    platforms: ['steam', 'humble', 'fanatical', 'gmgn'],
  },
  'god-of-war': {
    id: 'god-of-war',
    title: 'God of War',
    cover: 'https://images.unsplash.com/photo-1552820728-8b83bb6b2b28?w=200&h=280&fit=crop',
    tags: ['动作', '冒险', '神话'],
    releases: '2022-01-14',
    steamId: 1593500,
    platforms: ['steam', 'humble', 'fanatical'],
  },
  'baldurs-gate-3': {
    id: 'baldurs-gate-3',
    title: "Baldur's Gate 3",
    cover: 'https://images.unsplash.com/photo-1538481199705-c7103a6a5cb5?w=200&h=280&fit=crop',
    tags: ['RPG', '策略', '回合制'],
    releases: '2023-08-03',
    steamId: 1086940,
    gogId: 'baldurs_gate_3',
    platforms: ['steam', 'gog', 'humble', 'fanatical', 'gmgn'],
  },
  'zelda-totk': {
    id: 'zelda-totk',
    title: 'Zelda: Tears of the Kingdom',
    cover: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=200&h=280&fit=crop',
    tags: ['动作', '冒险', '开放世界'],
    releases: '2023-05-12',
    platforms: ['humble', 'fanatical'],
  },
  'final-fantasy-xvi': {
    id: 'final-fantasy-xvi',
    title: 'Final Fantasy XVI',
    cover: 'https://images.unsplash.com/photo-1535223289827-42f1e9919769?w=200&h=280&fit=crop',
    tags: ['RPG', '动作', '日式'],
    releases: '2023-06-22',
    steamId: 2166690,
    platforms: ['steam', 'humble', 'fanatical', 'gmgn'],
  },
  'stellar-blade': {
    id: 'stellar-blade',
    title: 'Stellar Blade',
    cover: 'https://images.unsplash.com/photo-1551103782-8ab07afd45c1?w=200&h=280&fit=crop',
    tags: ['动作', '科幻', '冒险'],
    releases: '2024-04-26',
    platforms: ['humble', 'fanatical'],
  },
  'black-myth-wukong': {
    id: 'black-myth-wukong',
    title: 'Black Myth: Wukong',
    cover: 'https://images.unsplash.com/photo-1560167016-022b78a0258e?w=200&h=280&fit=crop',
    tags: ['动作', 'RPG', '神话'],
    releases: '2024-08-20',
    steamId: 2058970,
    epicSlug: 'black-myth-wukong',
    platforms: ['steam', 'epic', 'humble', 'fanatical'],
  },
  'hogwarts-legacy': {
    id: 'hogwarts-legacy',
    title: 'Hogwarts Legacy',
    cover: 'https://images.unsplash.com/photo-1597843786411-a7fa8ad44f86?w=200&h=280&fit=crop',
    tags: ['RPG', '魔法', '开放世界'],
    releases: '2023-02-10',
    steamId: 990080,
    gogId: 'hogwarts_legacy',
    platforms: ['steam', 'gog', 'humble', 'fanatical'],
  },
  'resident-evil-4': {
    id: 'resident-evil-4',
    title: 'Resident Evil 4',
    cover: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=200&h=280&fit=crop',
    tags: ['动作', '恐怖', '生存'],
    releases: '2023-03-24',
    steamId: 2050650,
    epicSlug: 'residents-evil-4-remake',
    platforms: ['steam', 'epic', 'humble', 'fanatical', 'gmgn'],
  },
  'starfield': {
    id: 'starfield',
    title: 'Starfield',
    cover: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=200&h=280&fit=crop',
    tags: ['RPG', '科幻', '开放世界'],
    releases: '2023-09-06',
    steamId: 1716740,
    platforms: ['steam', 'humble', 'fanatical', 'gmgn'],
  },
  'diablo-iv': {
    id: 'diablo-iv',
    title: 'Diablo IV',
    cover: 'https://images.unsplash.com/photo-1642480570509-75e5e8c9c5af?w=200&h=280&fit=crop',
    tags: ['ARPG', '动作', '暗黑'],
    releases: '2023-06-06',
    steamId: 2348590,
    platforms: ['steam', 'humble', 'fanatical'],
  },
  'palworld': {
    id: 'palworld',
    title: 'Palworld',
    cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&h=280&fit=crop',
    tags: ['生存', '开放世界', '冒险'],
    releases: '2024-01-19',
    steamId: 1623730,
    platforms: ['steam', 'humble', 'fanatical'],
  },
  'helldivers-2': {
    id: 'helldivers-2',
    title: 'Helldivers 2',
    cover: 'https://images.unsplash.com/photo-1550745165-9bc0b2c25b36?w=200&h=280&fit=crop',
    tags: ['射击', '动作', '合作'],
    releases: '2024-02-08',
    steamId: 5538500,
    platforms: ['steam', 'humble', 'fanatical'],
  },
  'persona-5-royal': {
    id: 'persona-5-royal',
    title: 'Persona 5 Royal',
    cover: 'https://images.unsplash.com/photo-1528360983297-30e65446382b?w=200&h=280&fit=crop',
    tags: ['RPG', '日式', '回合制'],
    releases: '2022-10-21',
    steamId: 1687750,
    gogId: 'persona_5_royal',
    platforms: ['steam', 'gog', 'humble', 'fanatical'],
  },
  'monster-hunter-wilds': {
    id: 'monster-hunter-wilds',
    title: 'Monster Hunter Wilds',
    cover: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=200&h=280&fit=crop',
    tags: ['动作', 'RPG', '狩猎'],
    releases: '2025-03-07',
    steamId: 2142210,
    platforms: ['steam', 'humble', 'fanatical', 'gmgn'],
  },
  'metaphor-refantazio': {
    id: 'metaphor-refantazio',
    title: 'Metaphor: ReFantazio',
    cover: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=200&h=280&fit=crop',
    tags: ['RPG', '日式', '幻想'],
    releases: '2024-10-11',
    steamId: 2179500,
    platforms: ['steam', 'humble', 'fanatical', 'gmgn'],
  },
  'zenless-zone-zero': {
    id: 'zenless-zone-zero',
    title: 'Zenless Zone Zero',
    cover: 'https://images.unsplash.com/photo-1534423861386-85d1805745c9?w=200&h=280&fit=crop',
    tags: ['动作', 'RPG', '二次元'],
    releases: '2024-07-04',
    platforms: [],
  },
  'animal-crossing': {
    id: 'animal-crossing',
    title: 'Animal Crossing: New Horizons',
    cover: 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=200&h=280&fit=crop',
    tags: ['模拟', '休闲', '生活'],
    releases: '2020-03-20',
    platforms: ['humble', 'fanatical'],
  },
};

export function searchGameCatalog(query: string): GameEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return Object.values(GAME_CATALOG).filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q)) ||
      g.id.includes(q)
  );
}

export interface ScrapedGameResult {
  id: string;
  title: string;
  cover: string;
  tags: string[];
  releases: string;
  prices: PlatformPriceResult[];
  scrapedAt: number;
  successCount: number;
  errors: string[];
}

export async function scrapeGamePrices(game: GameEntry): Promise<ScrapedGameResult> {
  const scrapers: Array<Promise<PlatformPriceResult>> = [];

  if (game.platforms.includes('steam') && game.steamId) {
    scrapers.push(scrapeSteam(game.steamId));
  } else if (game.platforms.includes('steam')) {
    scrapers.push(Promise.resolve({ platform: 'Steam', priceCents: 0, url: 'https://store.steampowered.com', currency: 'CNY', success: false, error: '无 Steam ID' }));
  }

  if (game.platforms.includes('epic') && game.epicSlug) {
    scrapers.push(scrapeEpic(game.epicSlug));
  } else if (game.platforms.includes('epic')) {
    scrapers.push(Promise.resolve({ platform: 'Epic Games', priceCents: 0, url: 'https://www.epicgames.com/store', currency: 'CNY', success: false, error: '无 Epic Slug' }));
  }

  if (game.platforms.includes('gog') && game.gogId) {
    scrapers.push(scrapeGog(game.gogId));
  } else if (game.platforms.includes('gog')) {
    scrapers.push(Promise.resolve({ platform: 'GOG', priceCents: 0, url: 'https://www.gog.com', currency: 'CNY', success: false, error: '无 GOG ID' }));
  }

  if (game.platforms.includes('humble')) {
    scrapers.push(scrapeHumble(game.title));
  }

  if (game.platforms.includes('fanatical')) {
    scrapers.push(scrapeFanatical(game.title));
  }

  if (game.platforms.includes('gmgn')) {
    scrapers.push(scrapeGMGN(game.title));
  }

  const results = await Promise.allSettled(scrapers);
  const prices: PlatformPriceResult[] = results
    .filter((r): r is PromiseFulfilledResult<PlatformPriceResult> => r.status === 'fulfilled')
    .map((r) => r.value);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  return {
    id: game.id,
    title: game.title,
    cover: game.cover,
    tags: game.tags,
    releases: game.releases,
    prices,
    scrapedAt: Date.now(),
    successCount: prices.filter((p) => p.success).length,
    errors,
  };
}
