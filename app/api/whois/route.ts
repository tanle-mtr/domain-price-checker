import { NextResponse } from "next/server";
import net from "node:net";
import { domainToASCII } from "node:url";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-static";

/** WHOIS 服务器映射 (按 TLD) */
const WHOIS_SERVERS: Record<string, string> = {
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.pir.org",
  info: "whoisafil.info",
  name: "whois.netsol.com",
  me: "whois.nic.me",
  tv: "whois.nic.tv",
  cc: "whois.nic.cc",
  io: "whois.nic.io",
  co: "whois.nic.co",
  dev: "whois.nic.dev",
  app: "whois.nic.app",
  xyz: "whois.centralnic.com",
  cn: "whois.cnnic.cn",
  top: "whois.nic.top",
  vip: "whois.nic.vip",
  site: "whois.nic.site",
  tech: "whois.nic.tech",
  online: "whois.nic.online",
};

/** RDAP 端点映射 */
const RDAP_ENDPOINTS: Record<string, string[]> = {
  com: ["https://rdap.verisign.com/com/v1/domain/"],
  net: ["https://rdap.verisign.com/net/v1/domain/"],
  org: ["https://rdap.publicinterestregistry.org/rdap/"],
  info: ["https://rdap.identitydigital.services/rdap/"],
  me: ["https://rdap.nic.me/", "https://rdap.domenca.me/rdap/"],
  tv: ["https://rdap.nic.tv/"],
  cc: ["https://tld-rdap.verisign.com/cc/v1/"],
  io: ["https://rdap.identitydigital.services/rdap/", "https://rdap.nic.io/"],
  co: ["https://rdap.nic.co/"],
  dev: ["https://pubapi.registry.google/rdap/"],
  app: ["https://pubapi.registry.google/rdap/"],
  xyz: ["https://rdap.centralnic.com/xyz/domain/"],
  cn: ["https://rdap.cnnic.cn/"],
  top: ["https://rdap.zdnsgtld.com/top/"],
  vip: ["https://rdap.nic.vip/"],
  site: ["https://rdap.radix.host/rdap/"],
  tech: ["https://rdap.radix.host/rdap/"],
  online: ["https://rdap.radix.host/rdap/"],
};

interface WhoisResult {
  domain: string;
  status: "available" | "registered" | "error";
  raw?: string;
  parsed?: ParsedWhois;
  source: "rdap" | "whois" | "fallback";
  error?: string;
}

interface ParsedWhois {
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

/** TCP WHOIS 查询 */
async function whoisTcpQuery(domain: string, server: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 43, host: server }, () => {
      client.write(domain + "\r\n");
    });

    let data = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("WHOIS TCP timeout"));
    }, timeoutMs);

    client.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });

    client.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 解析 WHOIS 文本响应 */
function parseWhoisText(data: string, tld?: string): ParsedWhois | null {
  if (!data) return null;

  const parsed: ParsedWhois = { rawText: data };
  const lines = data.split(/\r?\n/);

  // 检查是否可用
  if (
    data.includes("No match for") ||
    data.includes("NOT FOUND") ||
    data.includes("No matches") ||
    data.includes("is free") ||
    data.includes("is unregistered") ||
    data.includes("NOT FOUND")
  ) {
    parsed.status = ["available"];
    return parsed;
  }

  let lastKey = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      //  continuation line
      if (lastKey && parsed[lastKey as keyof ParsedWhois]) {
        const key = lastKey as keyof ParsedWhois;
        if (key === "nameservers" || key === "status") {
          // Append to array
          const arr = parsed[key] as string[];
          if (arr) arr.push(trimmed);
        } else {
          (parsed as Record<string, unknown>)[lastKey] =
            ((parsed as Record<string, unknown>)[lastKey] as string) + " " + trimmed;
        }
      }
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, "_");
    const value = trimmed.slice(colonIdx + 1).trim();

    if (!value) {
      lastKey = key;
      continue;
    }

    lastKey = key;

    // 标准化键名
    const normalizedKey = normalizeWhoisKey(key, value);
    if (normalizedKey) {
      (parsed as Record<string, unknown>)[normalizedKey.key] = normalizedKey.value;
    }
  }

  // 如果没有解析到任何信息，返回原始文本
  if (!parsed.registrar && !parsed.creationDate && !parsed.expiryDate && !parsed.nameservers) {
    return { rawText: data };
  }

  return parsed;
}

/** 标准化 WHOIS 键名 */
function normalizeWhoisKey(
  key: string,
  value: string
): { key: string; value: string | undefined } | null {
  // 创建日期
  if (
    key.includes("creation_date") ||
    key.includes("created") ||
    key.includes("registered") ||
    key.includes("creation date") ||
    key.includes("domain name commencement date")
  ) {
    return { key: "creationDate", value: extractDate(value) as string };
  }

  // 到期日期
  if (
    key.includes("expiry_date") ||
    key.includes("expiration") ||
    key.includes("expire") ||
    key.includes("registry expiry") ||
    key.includes("paid-till")
  ) {
    return { key: "expiryDate", value: extractDate(value) as string };
  }

  // 更新日期
  if (
    key.includes("updated") ||
    key.includes("last_updated") ||
    key.includes("last update") ||
    key.includes("modified")
  ) {
    return { key: "updatedDate", value: extractDate(value) as string };
  }

  // 注册商
  if (
    key.includes("registrar") ||
    key.includes("registered by") ||
    key.includes("sponsor")
  ) {
    const cleanValue = value
      .replace(/\s*\([^)]*\)/g, "") // 移除括号内容
      .replace(/\s+/g, " ")
      .trim();
    return { key: "registrar", value: cleanValue };
  }

  // 注册商 URL
  if (
    key.includes("registrar url") ||
    key.includes("registrar www") ||
    key.includes("registrar homepage")
  ) {
    return { key: "registrarUrl", value: value.trim() };
  }

  // 注册局 ID
  if (
    key.includes("registry domain id") ||
    key.includes("domain id") ||
    key.includes("registrar iana id")
  ) {
    return { key: "registryDomainId", value: value.trim() };
  }

  // Nameservers
  if (
    key.includes("nameserver") ||
    key.includes("ns ") ||
    key.match(/^ns\d*$/)
  ) {
    const ns = value.trim();
    if (ns) {
      return { key: "nameservers", value: ns };
    }
  }

  // Status
  if (
    key.includes("status") ||
    key.includes("domain status") ||
    key.includes("registration status")
  ) {
    const status = value
      .split(/[,\s]+/)
      .filter((s) => s.length > 0)
      .map((s) => s.replace(/[\[\]]/g, ""));
    return { key: "status", value: status.join(", ") };
  }

  return null;
}

/** 从 WHOIS 值中提取日期 */
function extractDate(value: string): string | undefined {
  if (!value) return undefined;

  // 尝试多种日期格式
  const patterns = [
    /(\d{4}-\d{2}-\d{2})/i, // ISO: 2024-01-15
    /(\d{2}[-\/]\d{2}[-\/]\d{4})/i, // US/EU: 01/15/2024 or 15-01-2024
    /(\d{4}\.\d{2}\.\d{2})/, // 2024.01.15
    /([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})/i, // Jan 15, 2024
    /(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})/i, // 15 Jan 2024
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const date = new Date(match[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }

  // 返回原始值
  return value.slice(0, 20);
}

/** RDAP 查询 */
async function rdapQuery(domain: string, tld: string): Promise<WhoisResult | null> {
  const endpoints = RDAP_ENDPOINTS[tld] ?? ["https://rdap.org/domain/"];

  for (const base of endpoints) {
    const url = `${base}${domain}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: { accept: "application/rdap+json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 200) {
        const data = await res.json().catch(() => null);
        if (data) {
          return parseRdapResponse(domain, data);
        }
      } else if (res.status === 404) {
        return {
          domain,
          status: "available",
          source: "rdap",
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** 解析 RDAP 响应 */
function parseRdapResponse(domain: string, data: any): WhoisResult {
  const parsed: ParsedWhois = {};

  // 解析事件日期
  for (const event of data.events ?? []) {
    const action = event.eventAction ?? "";
    const date = event.eventDate;
    if (!date) continue;

    if (
      action === "creation" ||
      action === "registration" ||
      action === "registration creation"
    ) {
      parsed.creationDate = new Date(date).toISOString().slice(0, 10);
    } else if (
      action === "expiration" ||
      action === "registration expiration"
    ) {
      parsed.expiryDate = new Date(date).toISOString().slice(0, 10);
    } else if (
      action === "last changed" ||
      action === "last update of RDAP database"
    ) {
      parsed.updatedDate = new Date(date).toISOString().slice(0, 10);
    }
  }

  // 解析注册商
  for (const entity of data.entities ?? []) {
    const roles = entity.roles ?? [];
    if (roles.includes("registrar")) {
      const vcard = entity.vcardArray;
      if (vcard?.[1]) {
        const fn = vcard[1].find(
          (f: any[]) => Array.isArray(f) && f[0] === "fn"
        );
        if (fn?.[3]) parsed.registrar = String(fn[3]);
      }
      const links = entity.links ?? [];
      const aboutLink = links.find(
        (l: any) => l.rel === "about" || l.rel === "related"
      );
      if (aboutLink?.href) parsed.registrarUrl = aboutLink.href;
    }
  }

  // 解析 Nameservers
  if (data.nameservers?.length) {
    parsed.nameservers = data.nameservers
      .map((ns: any) => ns.ldhName)
      .filter(Boolean);
  }

  // 解析状态
  if (data.status?.length) {
    parsed.status = data.status;
  }

  // 解析注册局 ID
  if (data.handle) {
    parsed.registryDomainId = data.handle;
  }

  return {
    domain,
    status: "registered",
    parsed,
    source: "rdap",
  };
}

/** 主处理函数 */
export async function POST(req: Request) {
  let body: { domain?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawDomain = String(body.domain ?? "").trim().toLowerCase();
  if (!rawDomain) {
    return NextResponse.json({ error: "请提供域名" }, { status: 400 });
  }

  // 清理域名
  const domain = rawDomain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "");

  // 验证域名格式
  const domainRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  const tldMatch = domain.match(/\.([a-z]{2,})$/);
  if (!domainRe.test(domain) && !tldMatch) {
    return NextResponse.json({ error: "域名格式不正确" }, { status: 400 });
  }

  const tld = tldMatch?.[1] || "com";
  const fullDomain = domainToASCII(domain).toLowerCase();

  // 1. 优先尝试 RDAP
  const rdapResult = await rdapQuery(fullDomain, tld);
  if (rdapResult) {
    return NextResponse.json({ result: rdapResult });
  }

  // 2. 回退到 TCP WHOIS
  const whoisServer = WHOIS_SERVERS[tld] || "whois.internic.net";
  try {
    const rawText = await whoisTcpQuery(fullDomain, whoisServer);
    const parsed = parseWhoisText(rawText, tld);

    // 判断是否可用
    let status: "available" | "registered" | "error" = "registered";
    if (
      rawText.includes("No match for") ||
      rawText.includes("NOT FOUND") ||
      rawText.includes("is free") ||
      rawText.includes("No matches")
    ) {
      status = "available";
    }

    return NextResponse.json({
      result: {
        domain: fullDomain,
        status,
        raw: rawText,
        parsed,
        source: "whois",
      },
    });
  } catch (err) {
    // 3. 最后尝试公共 API
    try {
      const res = await fetch("https://whois-api-zeta.vercel.app/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: fullDomain }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const apiData = await res.json();
        return NextResponse.json({
          result: {
            domain: fullDomain,
            status: apiData.available ? "available" : "registered",
            parsed: apiData,
            source: "fallback",
          },
        });
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        result: {
          domain: fullDomain,
          status: "error",
          error: err instanceof Error ? err.message : "WHOIS查询失败",
          source: "error",
        },
      },
      { status: 200 }
    );
  }
}
