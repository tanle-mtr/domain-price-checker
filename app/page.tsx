'use client';

import { useCallback, useEffect, useState } from 'react';
import SearchForm from '@/components/SearchForm';
import CurrencyBar from '@/components/CurrencyBar';
import ResultSection from '@/components/ResultSection';
import { DEFAULT_TLDS } from '@/lib/tlds';
import type { AvailabilityResult } from '@/lib/rdap';
import {
  DEFAULT_USD_TO_CNY_RATE,
  type CurrencyCode,
} from '@/lib/currency';

export default function Home() {
  const [name, setName] = useState('');
  const [tlds, setTlds] = useState<string[]>(DEFAULT_TLDS);
  const [results, setResults] = useState<AvailabilityResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [rate, setRate] = useState(DEFAULT_USD_TO_CNY_RATE);

  useEffect(() => {
    const savedCurrency = localStorage.getItem('dp-currency');
    if (savedCurrency === 'USD' || savedCurrency === 'CNY') {
      setCurrency(savedCurrency);
    }
    const savedRate = parseFloat(localStorage.getItem('dp-rate') ?? '');
    if (!Number.isNaN(savedRate) && savedRate > 0) {
      setRate(savedRate);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('dp-currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('dp-rate', String(rate));
  }, [rate]);

  const handleSearch = useCallback(async (n: string, ts: string[]) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, tlds: ts }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '查询失败，请稍后重试');
      }
      setName(n);
      setTlds(ts);
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 text-center">
        <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
          比价 · 查询 · 一键购买
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
          域名价格查询
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          输入一个名称，对比主流注册商的首年与续费价格
        </p>
      </header>

      <CurrencyBar
        currency={currency}
        rate={rate}
        onCurrency={setCurrency}
        onRate={setRate}
      />

      <SearchForm
        loading={loading}
        onSearch={handleSearch}
        initialName={name}
        initialTlds={tlds}
      />

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && (
        <div className="mt-8 flex items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <svg
            className="h-5 w-5 animate-spin text-blue-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          正在查询 {tlds.length} 个后缀，请稍候…
        </div>
      )}

      {results && !loading && (
        <ResultSection results={results} currency={currency} rate={rate} />
      )}
    </main>
  );
}