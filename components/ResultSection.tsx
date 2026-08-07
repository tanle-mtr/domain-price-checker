import { REGISTRARS, checkoutUrl, cheapestFirstYear } from '@/lib/pricing';
import { formatPrice, type CurrencyCode } from '@/lib/currency';
import type { AvailabilityResult } from '@/lib/rdap';

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
  unknown: {
    label: '未知',
    cls: 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300',
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
                            {formatPrice(reg.firstYear, currency, rate)}
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {r.status === 'registered'
                  ? '该域名已被注册，可尝试更换后缀或调整名称。'
                  : r.error
                    ? `暂时无法查询：${r.error}`
                    : '暂时无法查询该后缀的状态，请稍后重试。'}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}