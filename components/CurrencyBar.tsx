'use client';

import {
  CURRENCY_LABELS,
  CURRENCY_SYMBOLS,
  type CurrencyCode,
} from '@/lib/currency';

interface Props {
  currency: CurrencyCode;
  rate: number;
  onCurrency: (c: CurrencyCode) => void;
  onRate: (r: number) => void;
}

export default function CurrencyBar({
  currency,
  rate,
  onCurrency,
  onRate,
}: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3 text-sm text-slate-500 dark:text-slate-400">
      <div className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
        {(['USD', 'CNY'] as CurrencyCode[]).map((c) => (
          <button
            key={c}
            onClick={() => onCurrency(c)}
            className={`px-3 py-1.5 transition-colors ${
              currency === c
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {CURRENCY_LABELS[c].split(' ')[0]}
          </button>
        ))}
      </div>
      {currency === 'CNY' && (
        <label className="flex items-center gap-2">
          汇率
          <input
            type="number"
            step="0.01"
            min="1"
            value={rate}
            onChange={(e) => onRate(parseFloat(e.target.value) || 1)}
            className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <span className="text-slate-500 dark:text-slate-400">
            {CURRENCY_SYMBOLS.USD} → {CURRENCY_SYMBOLS.CNY}
          </span>
        </label>
      )}
    </div>
  );
}