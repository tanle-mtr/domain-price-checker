import { REGISTRARS, checkoutUrl, cheapestFirstYear } from '@/lib/pricing';
import { formatPrice, type CurrencyCode } from '@/lib/currency';
import type { AvailabilityResult } from '@/lib/rdap';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface ScrapedPrice {
  registrar: string;
  firstYear: number | null;
  renewal: number | null;
  currency: string;
  source: 'realtime' | 'fallback';
  success: boolean;
}

interface Props {
  results: AvailabilityResult[];
  currency: CurrencyCode;
  rate: number;
}

function safeDateCalc(expiryDate: string | null | undefined): { daysLeft: number | null; isExpired: boolean; isSoon: boolean } {
  if (!expiryDate) {
    return { daysLeft: null, isExpired: false, isSoon: false };
  }
  try {
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      return { daysLeft: null, isExpired: false, isSoon: false };
    }
    const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return {
      daysLeft,
      isExpired: daysLeft < 0,
      isSoon: daysLeft >= 0 && daysLeft < 30,
    };
  } catch {
    return { daysLeft: null, isExpired: false, isSoon: false };
  }
}

export default function ResultSection({ results, currency, rate }: Props) {
  const [scrapedPrices, setScrapedPrices] = useState<Record<string, ScrapedPrice[]>>({});
  const [loadingPrices, setLoadingPrices] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Record<string, number>>({});

  // 获取实时价格 - 先 WHOIS 检查，再爬虫
  useEffect(() => {
    const fetchPrices = async () => {
      for (const r of results) {
        if (r.status !== 'available') continue;
        if (scrapedPrices[r.full]) continue;
        if (loadingPrices.has(r.full)) continue;
        
        setLoadingPrices(prev => new Set(prev).add(r.full));
        try {
          const res = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: r.full.split('.')[0], tld: r.tld }),
          });
          const data = await res.json();
          if (data.prices && data.status === 'available') {
            setScrapedPrices(prev => ({
              ...prev,
              [r.full]: data.prices.map((p: any) => ({
                registrar: p.registrar,
                firstYear: p.price,
                renewal: p.price ? p.price * 1.2 : null,
                currency: p.currency,
                source: p.source || 'fallback',
                success: p.success || false,
              })),
            }));
            setLastUpdated(prev => ({ ...prev, [r.full]: Date.now() }));
          }
        } catch (e) {
          console.error(`Failed to scrape price for ${r.full}:`, e);
        } finally {
          setLoadingPrices(prev => {
            const next = new Set(prev);
            next.delete(r.full);
            return next;
          });
        }
      }
    };
    fetchPrices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // 手动刷新价格
  const handleRefresh = async (domain: string, tld: string) => {
    setLoadingPrices(prev => new Set(prev).add(domain));
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.split('.')[0], tld }),
      });
      const data = await res.json();
      if (data.prices && data.status === 'available') {
        setScrapedPrices(prev => ({
          ...prev,
          [domain]: data.prices.map((p: any) => ({
            registrar: p.registrar,
            firstYear: p.price,
            renewal: p.price ? p.price * 1.2 : null,
            currency: p.currency,
            source: p.source || 'fallback',
            success: p.success || false,
          })),
        }));
        setLastUpdated(prev => ({ ...prev, [domain]: Date.now() }));
      }
    } catch (e) {
      console.error(`Failed to refresh price for ${domain}:`, e);
    } finally {
      setLoadingPrices(prev => {
        const next = new Set(prev);
        next.delete(domain);
        return next;
      });
    }
  };

  // 获取注册商的实时价格
  const getScrapedPrice = (domain: string, registrar: string) => {
    const prices = scrapedPrices[domain] || [];
    const found = prices.find(p => p.registrar === registrar);
    if (found?.success) {
      return { firstYear: found.firstYear, renewal: found.renewal, source: found.source };
    }
    return null;
  };

  if (!results || results.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 space-y-4">
      {results.map((r) => {
        const isAvailable = r.status === 'available';
        const { daysLeft, isExpired, isSoon } = safeDateCalc(r.whois?.expiryDate);
        
        return (
          <div
            key={r.full}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xl font-bold">{r.full}</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  isAvailable 
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' 
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}>
                  {isAvailable ? '可注册' : '已注册'}
                </span>
              </div>
              {r.registrar && (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {r.registrar}
                  {r.expiry && ` · ${r.expiry}`}
                </span>
              )}
            </div>

            {isAvailable && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-slate-500">
                    ⓘ 价格为参考价，实际价格以注册商结算页为准
                    {loadingPrices.has(r.full) && ' - 正在查询价格...'}
                    {lastUpdated[r.full] && !loadingPrices.has(r.full) && ` - 更新于 ${new Date(lastUpdated[r.full]).toLocaleTimeString('zh-CN')}`}
                  </p>
                  <button
                    onClick={() => handleRefresh(r.full, r.tld)}
                    disabled={loadingPrices.has(r.full)}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400 disabled:opacity-50"
                  >
                    🔄 刷新
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                        <th className="py-2 text-left pr-4">注册商</th>
                        <th className="py-2 text-left pr-4">首年</th>
                        <th className="py-2 text-left pr-4">续费</th>
                        <th className="py-2 text-left pr-4">两年合计</th>
                        <th className="py-2 text-left pr-4">WHOIS 保护</th>
                        <th className="py-2 text-left">购买</th>
                      </tr>
                    </thead>
                    <tbody>
                      {REGISTRARS.filter(reg => !reg.excludeTlds?.includes(r.tld)).map((reg) => {
                        const scraped = getScrapedPrice(r.full, reg.registrar);
                        const firstYear = scraped?.firstYear || reg.firstYear;
                        const renewal = scraped?.renewal || reg.renewal;
                        const cheapest = cheapestFirstYear(r.tld)?.registrar === reg.registrar;
                        return (
                          <tr key={reg.registrar} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                            <td className="py-3 pr-4">
                              <span className="font-medium">{reg.registrar}</span>
                              {scraped?.source === 'realtime' && (
                                <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">✓实时</span>
                              )}
                              {scraped?.source === 'fallback' && (
                                <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">↺备用</span>
                              )}
                              {cheapest && (
                                <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded dark:bg-blue-900/30 dark:text-blue-300">
                                  最便宜
                                </span>
                              )}
                            </td>
                            <td className="py-3 pr-4">{formatPrice(firstYear, currency, rate)}</td>
                            <td className="py-3 pr-4">{formatPrice(renewal, currency, rate)}</td>
                            <td className="py-3 pr-4">{formatPrice(firstYear + renewal, currency, rate)}</td>
                            <td className="py-3 pr-4">
                              {reg.whoisProtection > 0
                                ? `${formatPrice(reg.whoisProtection, currency, rate)}/年`
                                : <span className="text-emerald-600 dark:text-emerald-400">免费</span>}
                            </td>
                            <td className="py-3">
                              <a
                                href={checkoutUrl(reg, r.full)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline dark:text-blue-400 font-medium"
                              >
                                去购买 →
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!isAvailable && (
              <div className="p-4 bg-slate-50 rounded-lg dark:bg-slate-800">
                <h3 className="font-medium text-slate-700 dark:text-slate-200 mb-3">
                  WHOIS 信息
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {r.whois?.registrar && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">注册商：</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {r.whois.registrar}
                      </span>
                    </div>
                  )}
                  {r.whois?.creationDate && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">创建日期：</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {r.whois.creationDate}
                      </span>
                    </div>
                  )}
                  {r.whois?.expiryDate && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">到期日期：</span>
                      <span className={`font-medium ${isExpired ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {r.whois.expiryDate}
                      </span>
                      {isExpired && (
                        <span className="ml-1 text-xs text-red-500">
                          （已过期{daysLeft !== null ? Math.abs(daysLeft) : 0}天）
                        </span>
                      )}
                      {isSoon && (
                        <span className="ml-1 text-xs text-orange-500">
                          （即将到期）
                        </span>
                      )}
                      {!isExpired && !isSoon && daysLeft !== null && (
                        <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                          （剩余{daysLeft}天）
                        </span>
                      )}
                    </div>
                  )}
                  {r.whois?.updatedDate && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">更新日期：</span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {r.whois.updatedDate}
                      </span>
                    </div>
                  )}
                </div>
                
                {r.whois?.nameservers && r.whois.nameservers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Nameservers：</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.whois.nameservers.slice(0, 5).map((ns, i) => (
                        <span key={i} className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                          {ns}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <Link
                    href={`/whois?domain=${encodeURIComponent(r.full)}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    查询完整 WHOIS 信息
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
