'use client';

import { useState, useEffect } from 'react';

interface WhoisParsed {
  registrar?: string;
  registrarUrl?: string;
  creationDate?: string;
  expiryDate?: string;
  updatedDate?: string;
  nameservers?: string[];
  status?: string[];
  registryDomainId?: string;
  rawText?: string;
}

interface WhoisResult {
  domain: string;
  status: 'available' | 'registered' | 'error';
  raw?: string;
  parsed?: WhoisParsed;
  source: string;
  error?: string;
}

export default function WhoisPage() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhoisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 从 URL 参数预填充域名
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const domainParam = params.get('domain');
    if (domainParam) {
      setDomain(domainParam);
    }
  }, []);

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/whois', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json();
      if (data.result) {
        setResult(data.result);
      } else {
        setError(data.error || '查询失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const getDaysUntilExpiry = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const days = Math.ceil(
      (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return days;
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
          WHOIS 查询
        </span>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          WHOIS 查询工具
        </h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          查询域名的注册信息、到期时间、注册商等详细数据
        </p>
      </header>

      <form onSubmit={handleQuery} className="mb-8">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value.toLowerCase())}
            placeholder="输入域名，如 google"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 outline-none transition-colors focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-8 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? '查询中…' : '查询'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          支持所有常见后缀，如 .com .net .org .xyz .cn 等
        </p>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-2xl font-semibold">{result.domain}</span>
            <span
              className={`rounded-full border px-3 py-1 text-sm font-medium ${
                result.status === 'available'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : result.status === 'registered'
                  ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300'
                  : 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300'
              }`}
            >
              {result.status === 'available'
                ? '可注册'
                : result.status === 'registered'
                ? '已注册'
                : '查询失败'}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              来源: {result.source}
            </span>
          </div>

          {result.status === 'registered' && result.parsed && (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {result.parsed.registrar && (
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400">注册商</span>
                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {result.parsed.registrar}
                    </p>
                    {result.parsed.registrarUrl && (
                      <a
                        href={result.parsed.registrarUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        访问官网 →
                      </a>
                    )}
                  </div>
                )}

                {result.parsed.creationDate && (
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400">创建日期</span>
                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {new Date(result.parsed.creationDate).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                )}

                {result.parsed.expiryDate && (
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400">到期日期</span>
                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {new Date(result.parsed.expiryDate).toLocaleDateString('zh-CN')}
                    </p>
                    {(() => {
                      const days = getDaysUntilExpiry(result.parsed.expiryDate);
                      if (days === null) return null;
                      if (days < 0) {
                        return (
                          <span className="mt-1 text-xs text-red-500">
                            已过期 {Math.abs(days)} 天
                          </span>
                        );
                      }
                      if (days < 30) {
                        return (
                          <span className="mt-1 text-xs text-orange-500">
                            即将到期 ({days} 天)
                          </span>
                        );
                      }
                      return (
                        <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          剩余 {days} 天
                        </span>
                      );
                    })()}
                  </div>
                )}

                {result.parsed.updatedDate && (
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400">更新日期</span>
                    <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                      {new Date(result.parsed.updatedDate).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                )}

                {result.parsed.registryDomainId && (
                  <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                    <span className="text-xs text-slate-500 dark:text-slate-400">注册局ID</span>
                    <p className="mt-1 font-mono text-sm text-slate-900 dark:text-slate-100">
                      {result.parsed.registryDomainId}
                    </p>
                  </div>
                )}
              </div>

              {/* Nameservers */}
              {result.parsed.nameservers && result.parsed.nameservers.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Nameservers ({result.parsed.nameservers.length})
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.parsed.nameservers.map((ns, i) => (
                      <span
                        key={i}
                        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {ns}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Status */}
              {result.parsed?.status && (
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <span className="text-xs text-slate-500 dark:text-slate-400">域名状态</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(Array.isArray(result.parsed.status) ? result.parsed.status : [result.parsed.status]).map((s: string, i: number) => (
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

              {/* Raw data toggle */}
              {result.raw && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                    查看原始 WHOIS 数据
                  </summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    {result.raw}
                  </pre>
                </details>
              )}
            </div>
          )}

          {result.status === 'available' && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/30">
              <p className="text-emerald-700 dark:text-emerald-300">
                该域名目前可注册！
              </p>
              <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
                您可以前往注册商处购买此域名
              </p>
            </div>
          )}
        </div>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400 dark:text-slate-600">
        <p>WHOIS 数据来源于各注册局公开信息，可能存在延迟</p>
        <p className="mt-1">查询结果仅供参考，实际状态请以注册商为准</p>
      </footer>
    </main>
  );
}
