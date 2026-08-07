'use client';

import { useState } from 'react';
import { TLDS } from '@/lib/tlds';

interface Props {
  loading: boolean;
  onSearch: (name: string, tlds: string[]) => void;
  initialName?: string;
  initialTlds?: string[];
}

export default function SearchForm({
  loading,
  onSearch,
  initialName = '',
  initialTlds,
}: Props) {
  const [name, setName] = useState(initialName);
  const [tlds, setTlds] = useState<string[]>(initialTlds ?? []);
  const [custom, setCustom] = useState('');

  const toggle = (tld: string) =>
    setTlds((prev) =>
      prev.includes(tld) ? prev.filter((t) => t !== tld) : [...prev, tld]
    );

  const addCustom = () => {
    const t = custom.trim().toLowerCase().replace(/^\./, '');
    if (/^[a-z0-9-]{2,24}$/.test(t) && !tlds.includes(t)) {
      setTlds((prev) => [...prev, t]);
      setCustom('');
    }
  };

  const submit = () => {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(name.trim())) return;
    if (tlds.length === 0) return;
    onSearch(name.trim().toLowerCase(), tlds);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="输入域名名称，如 google"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 outline-none transition-colors focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-8 py-3 font-medium text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? '查询中…' : '查询价格'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TLDS.map(({ tld, label }) => (
          <button
            key={tld}
            onClick={() => toggle(tld)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              tlds.includes(tld)
                ? 'border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-300'
                : 'border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-500 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCustom()}
            placeholder="+ 自定义后缀"
            className="w-32 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {custom && (
            <button
              onClick={addCustom}
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              添加
            </button>
          )}
        </div>
      </div>
    </div>
  );
}