import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "域名价格查询 | Domain Price Checker",
  description:
    "查询域名是否可注册，对比 Cloudflare、Porkbun、Namecheap、阿里云、腾讯云等主流注册商的首年与续费价格。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('dp-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-base font-bold tracking-tight text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
              >
                域名价格查询
              </Link>
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  href="/cheap"
                  className="rounded-lg px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                >
                  便宜域名
                </Link>
                <Link
                  href="/whois"
                  className="rounded-lg px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                >
                  WHOIS查询
                </Link>
                <Link
                  href="/game-prices"
                  className="rounded-lg px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-violet-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-violet-400"
                >
                  游戏比价
                </Link>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </nav>
        {children}
        <footer className="border-t border-slate-200 py-8 dark:border-slate-800">
          <p className="text-center text-xs text-slate-400 dark:text-slate-600">
            价格信息为公开参考价快照，实际以各注册商结算为准 · 域名状态请以注册局
            RDAP 查询为准
          </p>
        </footer>
      </body>
    </html>
  );
}
