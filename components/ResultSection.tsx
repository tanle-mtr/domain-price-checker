import { REGISTRARS, checkoutUrl, cheapestFirstYear } from '@/lib/pricing';
import { formatPrice, type CurrencyCode } from '@/lib/currency';
import type { AvailabilityResult } from '@/lib/rdap';
import Link from 'next/link';

interface Props {
  results: AvailabilityResult[];
  currency: CurrencyCode;
  rate: number;
}

const STATUS_UI = {
  available: {
    label: '可注册',
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  registered: {
    label: '已注册',
    cls: 'border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300',
  },
} as const;

export default function ResultSection({ results, currency, rate }: Props) {
  return (
    <section className="mt-8 space-y-6">
      {results.map((r) => {
        const ui = STATUS_UI[r.status];
        return (
          <div
            key={r.full}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900/60"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xl font-semibold">{r.full}</span>
                <span
                  className={`rounded-full border px-3 py-0.5 text-sm font-medium ${ui.cls}`}
                >
                  {ui.label}
                </span>
              </div>
              {r.registrar && (
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  注册商：{r.registrar}
                  {r.expiry ? ` · ${r.expiry.slice(0, 10)} 到期` : ''}
                </span>
              )}
            </div>

            {r.status === 'available' && (
              <div className="overflow-x-auto">
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  ⓘ 价格为参考价，实际价格以注册商结算页为准
                </p>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="py-2 pr-4 font-medium">注册商</th>
                      <th className="py-2 pr-4 font-medium">首年</th>
                      <th className="py-2 pr-4 font-medium">续费/年</th>
                      <th className="py-2 pr-4 font-medium">两年合计</th>
                      <th className="py-2 pr-4 font-medium">WHOIS 保护</th>
                      <th className="py-2 font-medium">链接</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REGISTRARS.map((reg) => {
                      if (reg.excludeTlds?.includes(r.tld)) return null;
                      const cheapest =
                        cheapestFirstYear(r.tld)?.registrar === reg.registrar;
                      return (
                        <tr
                          key={reg.registrar}
                          className="border-b border-slate-200/70 last:border-0 dark:border-slate-800/60"
                        >
                          <td className="py-2.5 pr-4 font-medium">
                            {reg.registrar}
                            {cheapest && (
                              <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-xs text-blue-600 dark:text-blue-300">
                                最便宜
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-1">
                              <span>{formatPrice(reg.firstYear, currency, rate)}</span>
                              {reg.note && (
                                <span className="text-xs text-slate-400" title={reg.note}>ⓘ</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-4">
                            {formatPrice(reg.renewal, currency, rate)}
                          </td>
                          <td className="py-2.5 pr-4">
                            {formatPrice(reg.firstYear + reg.renewal, currency, rate)}
                          </td>
                          <td className="py-2.5 pr-4">
                            {reg.whoisProtection > 0
                              ? `${formatPrice(reg.whoisProtection, currency, rate)}/年`
                              : '免费'}
                          </td>
                          <td className="py-2.5">
                            <a
                              href={checkoutUrl(reg, r.full)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                            >
                              购买 →
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {r.status !== 'available' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  该域名已被注册，可查看以下 WHOIS 信息了解详情。
                </p>
                
                {r.status === 'registered' && r.whois && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                      WHOIS 信息
                    </h4>
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      {r.whois.registrar && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">注册商：</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {r.whois.registrar}
                          </span>
                          {r.whois.registrarUrl && (
                            <a
                              href={r.whois.registrarUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 text-blue-600 hover:underline dark:text-blue-400"
                            >
                              [官网]
                            </a>
                          )}
                        </div>
                      )}
                      {r.whois.creationDate && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">创建日期：</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {new Date(r.whois.creationDate).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      )}
                      {r.whois.expiryDate && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">到期日期：</span>
                          <span className={`font-medium ${
                            new Date(r.whois.expiryDate) < new Date()
                              ? 'text-red-600 dark:text-red-400'
                              : 'font-medium text-slate-700 dark:text-slate-200'
                          }`}>
                            {new Date(r.whois.expiryDate).toLocaleDateString('zh-CN')}
                          </span>
                          {(() => {
                            const daysLeft = Math.ceil(
                              (new Date(r.whois.expiryDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                            );
                            if (daysLeft < 0) return <span className="ml-1 text-xs text-red-500">（已过期{Math.abs(daysLeft)}天）</span>;
                            if (daysLeft < 30) return <span className="ml-1 text-xs text-orange-500">（即将到期）</span>;
                            return null;
                          })()}
                        </div>
                      )}
                      {r.whois.updatedDate && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">更新日期：</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {new Date(r.whois.updatedDate).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      )}
                      {r.whois.registryDomainId && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">注册局ID：</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {r.whois.registryDomainId}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {r.whois.nameservers && r.whois.nameservers.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-slate-500 dark:text-slate-400">Nameservers：</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {r.whois.nameservers.map((ns, i) => (
                            <span
                              key={i}
                              className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                            >
                              {ns}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {r.whois.status && r.whois.status.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-slate-500 dark:text-slate-400">域名状态：</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {r.whois.status.map((s, i) => (
                            <span
                              key={i}
                              className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                      <a
                        href={`/whois?domain=${encodeURIComponent(r.full)}`}
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h6m2 4h-8m0 0l-4 4m4-4l-4-4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        查询完整 WHOIS 信息
                      </a>
                    </div>
                  </div>
                )}

                {/* 显示原始 WHOIS 文本（如果有） */}
                {r.whois?.rawText && (
                  <details className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <summary className="cursor-pointer px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                      查看原始 WHOIS 数据
                    </summary>
                    <pre className="mx-4 mb-4 max-h-40 overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {r.whois.rawText}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}