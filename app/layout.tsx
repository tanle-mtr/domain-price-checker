import type { Metadata } from "next";
import Link from "next/link";
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
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <nav className="border-b border-slate-800 bg-slate-900/60">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold hover:text-blue-400">
              域名价格查询
            </Link>
            <Link href="/cheap" className="text-slate-300 hover:text-blue-400">
              便宜域名
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}