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
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="输入域名名称，如 google"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-lg outline-none focus:border-blue-500"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-8 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
                ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                : 'border-slate-700 text-slate-400 hover:border-slate-500'
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
            className="w-32 rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
          {custom && (
            <button
              onClick={addCustom}
              className="text-sm text-blue-400 hover:underline"
            >
              添加
            </button>
          )}
        </div>
      </div>
    </div>
  );
}