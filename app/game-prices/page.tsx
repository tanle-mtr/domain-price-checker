'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameEntry,
  GAME_CATALOG,
  searchGameCatalog,
  scrapeGamePrices,
  getCache,
  setCache,
  PlatformPriceResult,
} from '@/lib/game-scraper';

type SortBy = 'price' | 'discount' | 'release' | 'success';

interface ScrapedGame extends GameEntry {
  prices: PlatformPriceResult[];
  scrapedAt: number;
  successCount: number;
  errors: string[];
  loading: boolean;
  error?: string;
}

const SORT_LABELS: Record<SortBy, string> = {
  price: '价格最低',
  discount: '折扣最大',
  release: '最新发布',
  success: '来源最多',
};

function formatPriceCents(cents: number): string {
  if (cents === 0) return '免费';
  if (cents >= 100) return `¥${(cents / 100).toFixed(0)}`;
  return `¥${(cents / 100).toFixed(2)}`;
}

function getCheapestPrice(prices: PlatformPriceResult[]): PlatformPriceResult | null {
  const valid = prices.filter((p) => p.success && p.priceCents > 0);
  if (valid.length === 0) return null;
  return valid.reduce((min, p) => (p.priceCents < min.priceCents ? p : min), valid[0]);
}

function getMaxDiscount(prices: PlatformPriceResult[]): number {
  return Math.max(...prices.map((p) => p.discount ?? 0));
}

export default function GamePricesPage() {
  const [query, setQuery] = useState('');
  const [allGames, setAllGames] = useState<ScrapedGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortBy>('price');
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrapeAll = useCallback(async (games: GameEntry[]) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setProgress({ current: 0, total: games.length });

    const results: ScrapedGame[] = [];
    for (let i = 0; i < games.length; i++) {
      if (controller.signal.aborted) break;

      const game = games[i];
      const cacheKey = game.id;
      const cached = getCache(cacheKey);
      if (cached) {
        results.push({
          ...game,
          prices: cached.prices,
          scrapedAt: cached.timestamp,
          successCount: cached.prices.filter((p) => p.success).length,
          errors: cached.prices.filter((p) => !p.success).map((p) => p.error ?? '未知错误'),
          loading: false,
        });
      } else {
        results.push({ ...game, prices: [], scrapedAt: 0, successCount: 0, errors: [], loading: true });
        setAllGames([...results]);

        try {
          const scraped = await scrapeGamePrices(game);
          if (!controller.signal.aborted) {
            setCache(cacheKey, { prices: scraped.prices, timestamp: scraped.scrapedAt });
            results[i] = { ...game, ...scraped, loading: false };
          }
        } catch (e) {
          if (!controller.signal.aborted) {
            results[i] = {
              ...game,
              prices: [],
              scrapedAt: Date.now(),
              successCount: 0,
              errors: [e instanceof Error ? e.message : String(e)],
              loading: false,
            };
          }
        }
      }

      setProgress({ current: i + 1, total: games.length });
      setAllGames([...results]);
    }

    setLoading(false);
    setProgress(null);
  }, []);

  const search = useCallback((q: string) => {
    if (!q.trim()) { setAllGames([]); return; }
    const found = searchGameCatalog(q);
    if (found.length === 0) {
      setAllGames([]);
      return;
    }
    scrapeAll(found);
  }, [scrapeAll]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) search(query);
    }, 400);
    return () => clearTimeout(timer);
  }, [query, search]);

  const sortedResults = [...allGames].sort((a, b) => {
    if (sort === 'price') {
      const aMin = getCheapestPrice(a.prices)?.priceCents ?? Infinity;
      const bMin = getCheapestPrice(b.prices)?.priceCents ?? Infinity;
      return aMin - bMin;
    }
    if (sort === 'discount') return getMaxDiscount(b.prices) - getMaxDiscount(a.prices);
    if (sort === 'release') return new Date(b.releases).getTime() - new Date(a.releases).getTime();
    return b.successCount - a.successCount;
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 text-center">
        <span className="inline-block rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-600 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
          实时爬虫比价
        </span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          游戏密钥比价
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          实时爬虫抓取 Steam、Epic、GOG、Humble Bundle、Fanatical、Green Man Gaming 的当前价格
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query.trim() && search(query)}
            placeholder="输入游戏名称搜索…"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition-colors focus:border-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-72"
          />
          <button
            onClick={() => search(query)}
            disabled={loading || !query.trim()}
            className="rounded-lg bg-violet-600 px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-violet-500 disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? '爬取中…' : '搜索'}
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm dark:border-slate-700 dark:bg-slate-900">
          {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                sort === key
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {progress && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300">
          正在爬取 {progress.current} / {progress.total} 款游戏
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-violet-200 dark:bg-slate-700">
            <div
              className="h-full bg-violet-500 transition-all"
              style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {!query.trim() && !loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-slate-400 dark:text-slate-500">
            输入游戏名称，实时爬虫对比各大平台 CDK 价格
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {['艾尔登法环', '黑神话：悟空', '赛博朋克2077', '博德之门3', '原神'].map((tag) => (
              <button
                key={tag}
                onClick={() => { setQuery(tag); search(tag); }}
                className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-500 transition-colors hover:border-violet-400 hover:text-violet-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-violet-500 dark:hover:text-violet-300"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && allGames.length === 0 && query.trim() && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <svg className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            未找到「{query}」，请尝试其他关键词（如英文名或拼音）
          </p>
        </div>
      )}

      <div className="space-y-3">
        {sortedResults.map((game) => {
          const cheapest = getCheapestPrice(game.prices);
          const maxDiscount = getMaxDiscount(game.prices);
          const isExpanded = expandedGame === game.id;
          const hasAnyPrice = cheapest !== null;

          return (
            <div
              key={game.id}
              className="overflow-hidden rounded-xl border bg-white shadow-sm transition-colors dark:bg-slate-900/60"
              style={{
                borderColor: game.loading
                  ? 'rgb(139 92 246 / 0.3)'
                  : hasAnyPrice
                  ? 'rgb(16 185 129 / 0.3)'
                  : undefined,
              }}
            >
              <div className="flex gap-4 p-4">
                <div className="hidden h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg sm:block">
                  <img
                    src={game.cover}
                    alt={game.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                          {game.title}
                        </h3>
                        {game.loading && (
                          <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
                            爬取中
                          </span>
                        )}
                        {!game.loading && game.successCount === 0 && game.errors.length > 0 && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
                            抓取失败
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {game.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="text-xs text-slate-400 dark:text-slate-500">{game.releases}</span>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      {game.loading ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="h-5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                          <span className="text-xs text-slate-400">等待爬取…</span>
                        </div>
                      ) : hasAnyPrice ? (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {formatPriceCents(cheapest!.priceCents)}
                            </span>
                            {cheapest!.originalPriceCents && cheapest!.originalPriceCents > cheapest!.priceCents && (
                              <span className="text-sm text-slate-400 line-through">
                                {formatPriceCents(cheapest!.originalPriceCents)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-emerald-600 dark:text-emerald-400">
                            {cheapest!.platform} · 最低价
                          </p>
                          {maxDiscount > 0 && (
                            <span className="mt-0.5 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-500/20 dark:text-red-300">
                              -{maxDiscount}%
                            </span>
                          )}
                        </>
                      ) : game.errors.length > 0 ? (
                        <div className="text-right">
                          <p className="text-sm text-red-500 dark:text-red-400">抓取失败</p>
                          <p className="max-w-[200px] text-xs text-slate-400 truncate">{game.errors[0]}</p>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">无数据</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {!game.loading && game.prices.length > 0 && (
                <button
                  onClick={() => setExpandedGame(isExpanded ? null : game.id)}
                  className="w-full border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-center text-sm text-violet-600 hover:bg-violet-50 dark:border-slate-800 dark:bg-slate-950/50 dark:text-violet-400 dark:hover:bg-violet-950/30"
                >
                  {isExpanded
                    ? '收起平台列表'
                    : `查看 ${game.prices.filter((p) => p.success).length} 个平台实时价格`}
                </button>
              )}

              {isExpanded && (
                <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                  <div className="space-y-2">
                    {game.prices
                      .sort((a, b) => {
                        if (a.success && !b.success) return -1;
                        if (!a.success && b.success) return 1;
                        return (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity);
                      })
                      .map((price, idx) => (
                        <a
                          key={price.platform}
                          href={price.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
                            !price.success
                              ? 'border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900'
                              : idx === 0
                              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30'
                              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {!price.success ? (
                              <span className="rounded bg-slate-300 px-1.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                失败
                              </span>
                            ) : idx === 0 ? (
                              <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-xs font-bold text-white">
                                最低
                              </span>
                            ) : null}
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {price.platform}
                            </span>
                            {price.discount ? (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-500/20 dark:text-red-300">
                                -{price.discount}%
                              </span>
                            ) : price.success ? (
                              <span className="text-xs text-slate-400">原价</span>
                            ) : null}
                            {!price.success && (
                              <span className="text-xs text-red-400">· {price.error}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {price.originalPriceCents && price.originalPriceCents > price.priceCents && (
                              <span className="text-sm text-slate-400 line-through">
                                {formatPriceCents(price.originalPriceCents)}
                              </span>
                            )}
                            <span
                              className={`font-semibold ${
                                !price.success
                                  ? 'text-slate-400'
                                  : idx === 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {price.success ? formatPriceCents(price.priceCents) : '—'}
                            </span>
                            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </div>
                        </a>
                      ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                    更新时间：{new Date(game.scrapedAt).toLocaleTimeString('zh-CN')} ·
                    数据来源：{game.prices.filter((p) => p.success).map((p) => p.platform).join('、')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-slate-400 dark:text-slate-600">
        实时爬虫价格，实际购买请以各平台结算页为准 · 部分站点可能需要翻墙访问 · 价格缓存 30 分钟
      </p>
    </main>
  );
}
