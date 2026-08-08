import { domainToASCII } from "node:url";
import { resolveAny } from "node:dns/promises";
import net from "node:net";

export type AvailabilityStatus = "available" | "registered";

export interface WhoisInfo {
  registrar?: string | null;
  registrarUrl?: string | null;
  creationDate?: string | null;
  expiryDate?: string | null;
  updatedDate?: string | null;
  nameservers?: string[] | null;
  status?: string[] | null;
  registryDomainId?: string | null;
  rawText?: string | null;
}

export interface AvailabilityResult {
  tld: string;
  full: string;
  status: AvailabilityStatus;
  registrar?: string | null;
  expiry?: string | null;
  source: "rdap" | "dns" | "whois" | "fallback";
  error?: string | null;
  whois?: WhoisInfo | null;
}

const RDAP_TIMEOUT_MS = 6500;
const DNS_TIMEOUT_MS = 3500;
const WHOIS_TIMEOUT_MS = 5000;

/** WHOIS TCP 服务器映射 */
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

/** IANA 官方 RDAP 直连端点（rdap.org 失败时的降级，按顺序尝试），覆盖常见后缀 */
const RDAP_DIRECT: Record<string, string[]> = {
  com: ["https://rdap.verisign.com/com/v1/"],
  net: ["https://rdap.verisign.com/net/v1/"],
  cc: ["https://tld-rdap.verisign.com/cc/v1/"],
  tv: ["https://rdap.nic.tv/"],
  name: ["https://tld-rdap.verisign.com/name/v1/"],
  org: ["https://rdap.publicinterestregistry.org/rdap/"],
  info: ["https://rdap.identitydigital.services/rdap/"],
  pro: ["https://rdap.identitydigital.services/rdap/"],
  io: ["https://rdap.identitydigital.services/rdap/", "https://rdap.nic.io/"],
  store: ["https://rdap.radix.host/rdap/"],
  xyz: ["https://rdap.centralnic.com/xyz/"],
  dev: ["https://pubapi.registry.google/rdap/"],
  app: ["https://pubapi.registry.google/rdap/"],
  cn: ["https://rdap.cnnic.cn/"],
  site: ["https://rdap.radix.host/rdap/"],
  tech: ["https://rdap.radix.host/rdap/"],
  online: ["https://rdap.radix.host/rdap/"],
  top: ["https://rdap.zdnsgtld.com/top/"],
  vip: ["https://rdap.nic.vip/"],
  co: ["https://rdap.nic.co/"],
  me: ["https://rdap.nic.me/", "https://rdap.domenca.me/rdap/"],
};

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/rdap+json, application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseRdap(
  data: unknown
): { registrar?: string; expiry?: string; whois?: WhoisInfo } {
  let registrar: string | undefined;
  let registrarUrl: string | undefined;
  let expiry: string | undefined;
  let creationDate: string | undefined;
  let updatedDate: string | undefined;
  let nameservers: string[] | undefined;
  let status: string[] | undefined;
  let registryDomainId: string | undefined;
  
  try {
    const obj = data as {
      handle?: string;
      ldhName?: string;
      entities?: { vcardArray?: [string, unknown[][]]; roles?: string[]; links?: { rel?: string; href?: string }[] }[];
      events?: { eventAction?: string; eventDate?: string }[];
      nameservers?: { ldhName?: string }[];
      status?: string[];
      links?: { rel?: string; href?: string }[];
    };
    
    // 解析注册商信息
    for (const entity of obj.entities ?? []) {
      const roles = entity.roles ?? [];
      if (roles.includes('registrar') && !registrar) {
        const vcard = entity.vcardArray;
        if (vcard && Array.isArray(vcard[1])) {
          const fnEntry = vcard[1].find((f) => Array.isArray(f) && f[0] === 'fn');
          if (fnEntry?.[3]) registrar = String(fnEntry[3]);
          else if (fnEntry?.[2]) registrar = String(fnEntry[2]);
        }
      }
      if (roles.includes('registrar') && !registrarUrl) {
        const aboutLink = (entity.links ?? []).find((l) => l.rel === 'about' || l.rel === 'related');
        if (aboutLink?.href) registrarUrl = aboutLink.href;
      }
    }
    
    // 解析事件日期
    for (const event of obj.events ?? []) {
      const action = event.eventAction ?? '';
      if (!event.eventDate) continue;
      
      if (
        action === 'creation' ||
        action === 'registration' ||
        action === 'registration creation'
      ) {
        creationDate = event.eventDate;
      } else if (
        action === 'expiration' ||
        action === 'registration expiration' ||
        action === 'registration_expiration'
      ) {
        expiry = event.eventDate;
      } else if (
        action === 'last changed' ||
        action === 'updated' ||
        action === 'last update of RDAP database'
      ) {
        updatedDate = event.eventDate;
      }
    }
    
    // 解析域名状态
    if (obj.status && Array.isArray(obj.status)) {
      status = obj.status;
    }
    
    // 解析注册商ID
    if (obj.handle) {
      registryDomainId = obj.handle;
    }
    
    // 解析 Nameservers
    if (obj.nameservers && Array.isArray(obj.nameservers)) {
      nameservers = obj.nameservers
        .map((ns) => ns.ldhName)
        .filter((n): n is string => Boolean(n));
    }
    
  } catch {
    // 解析失败不影响主流程
  }
  
  const whois: WhoisInfo = {
    registrar: registrar ?? null,
    registrarUrl: registrarUrl ?? null,
    creationDate: creationDate ?? null,
    expiryDate: expiry ?? null,
    updatedDate: updatedDate ?? null,
    nameservers: nameservers ?? null,
    status: status ?? null,
    registryDomainId: registryDomainId ?? null,
  };
  
  return { registrar, expiry, whois };
}

/** TCP WHOIS 查询 */
async function whoisTcpQuery(
  domain: string,
  server: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 43, host: server }, () => {
      client.write(domain + "\r\n");
    });

    let data = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("WHOIS timeout"));
    }, WHOIS_TIMEOUT_MS);

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

/** 解析 WHOIS 文本判断是否可注册 */
function parseWhoisAvailability(data: string): "available" | "registered" | null {
  if (!data) return null;

  // 明确标记为可用的关键词
  const availablePatterns = [
    /No match for/i,
    /NOT FOUND/i,
    /No matches/i,
    /is free/i,
    /is unregistered/i,
    /No matching record/i,
    /not registered/i,
    /No Data Found/i,
    /No entries found/i,
    /This query returned 0 objects/i,
    /No match$/im,
    /status: free/i,
    /Status: free/i,
  ];

  for (const pattern of availablePatterns) {
    if (pattern.test(data)) return "available";
  }

  // 明确标记为已注册的关键词
  const registeredPatterns = [
    /Domain Name:/i,
    /Registrant:/i,
    /Registrar:/i,
    /Creation Date:/i,
    /Expiry Date:/i,
    /Registration Date:/i,
    /Registry Expiry Date:/i,
    /Paid Toll:/i,
    /Renewal Date:/i,
    /Name Server:/i,
    /DNSSEC:/i,
    /Status:/i,
  ];

  for (const pattern of registeredPatterns) {
    if (pattern.test(data)) return "registered";
  }

  // 无法判断，返回 null
  return null;
}

/** 从 WHOIS 文本中解析详细信息 */
function parseWhoisData(data: string): WhoisInfo {
  const info: WhoisInfo = { rawText: data.slice(0, 2000) };

  if (!data) return info;

  const lines = data.split(/\r?\n/);
  let lastKey = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      // 续行
      if (lastKey) {
        const key = lastKey.toLowerCase();
        if (key === "nameserver" || key.startsWith("nameserver")) {
          if (!info.nameservers) info.nameservers = [];
          info.nameservers.push(trimmed);
        }
      }
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (!value) {
      lastKey = key;
      continue;
    }

    lastKey = key;

    // 注册商
    if (key.includes("registrar") && !info.registrar) {
      info.registrar = value
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // 注册商 URL
    if (key.includes("registrar url") || key.includes("registrar www")) {
      info.registrarUrl = value;
    }

    // 创建日期
    if (
      (key.includes("creation") || key.includes("created") || key.includes("registration date")) &&
      !info.creationDate
    ) {
      info.creationDate = extractDateFromWhois(value);
    }

    // 到期日期
    if (
      (key.includes("expiry") || key.includes("expiration") || key.includes("expire")) &&
      !info.expiryDate
    ) {
      info.expiryDate = extractDateFromWhois(value);
    }

    // 更新日期
    if (
      (key.includes("updated") || key.includes("last update") || key.includes("modified")) &&
      !info.updatedDate
    ) {
      info.updatedDate = extractDateFromWhois(value);
    }

    // Nameservers
    if (key.includes("nameserver") || key.match(/^ns\d*$/)) {
      if (!info.nameservers) info.nameservers = [];
      info.nameservers.push(value);
    }

    // Status
    if (key.includes("status") && !info.status) {
      info.status = value
        .split(/[,\s]+/)
        .filter((s) => s.length > 0)
        .map((s) => s.replace(/[\[\]]/g, ""));
    }

    // Registry Domain ID
    if (key.includes("registry domain id") || key.includes("domain id")) {
      info.registryDomainId = value;
    }
  }

  return info;
}

/** 从 WHOIS 值中提取日期 */
function extractDateFromWhois(value: string): string | undefined {
  if (!value) return undefined;

  const patterns = [
    /(\d{4}-\d{2}-\d{2})/i,
    /(\d{2}[-\/]\d{2}[-\/]\d{4})/i,
    /(\d{4}\.\d{2}\.\d{2})/,
    /([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})/i,
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

  return value.slice(0, 20);
}

export async function checkAvailability(
  name: string,
  tld: string
): Promise<AvailabilityResult> {
  try {
    const full = domainToASCII(`${name}.${tld}`).toLowerCase();

    // 1. 尝试 RDAP
    const endpoints = [
      `https://rdap.org/domain/${full}`,
      ...(RDAP_DIRECT[tld] ?? []).map((base) => `${base}domain/${full}`),
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetchWithTimeout(endpoint, RDAP_TIMEOUT_MS);
        if (res.status === 200) {
          const data = await res.json().catch(() => null);
          const { registrar, expiry, whois } = parseRdap(data);
          return {
            tld,
            full,
            status: "registered",
            registrar: registrar ?? null,
            expiry: expiry ?? null,
            source: "rdap",
            whois: whois,
          };
        }
        if (res.status === 404) {
          return {
            tld,
            full,
            status: "available",
            registrar: null,
            expiry: null,
            source: "rdap",
          };
        }
      } catch {
        // 尝试下一个端点
      }
    }

    // 2. DNS 检查作为快速预筛选
    let dnsResult: "registered" | "available" | null = null;
    try {
      const [aRecords, nsRecords] = await Promise.all([
        resolveAny(full).then((r) => r).catch(() => []),
        resolveNs(full).then((r) => r).catch(() => []),
      ]);
      if (aRecords.length > 0 || nsRecords.length > 0) {
        dnsResult = "registered";
      } else {
        dnsResult = "available";
      }
    } catch {
      dnsResult = null;
    }

    // 3. TCP WHOIS 作为权威确认（消除 unknown 状态）
    const whoisServer = WHOIS_SERVERS[tld] || "whois.internic.net";
    try {
      const whoisData = await whoisTcpQuery(full, whoisServer);
      const whoisStatus = parseWhoisAvailability(whoisData);
      if (whoisStatus) {
        return {
          tld,
          full,
          status: whoisStatus,
          source: "whois",
          registrar: null,
          expiry: null,
          whois: parseWhoisData(whoisData),
        };
      }
    } catch {
      // WHOIS 失败，使用 DNS 结果
    }

    // 4. 最终回退到 DNS 结果
    if (dnsResult) {
      return {
        tld,
        full,
        status: dnsResult,
        source: "dns",
      };
    }

    // 5. 所有方法都失败，返回 available（保守策略：宁可错放不可错杀）
    return {
      tld,
      full,
      status: "available",
      source: "fallback",
    };
  } catch (error) {
    // 捕获所有未预期的错误，返回安全默认值
    console.error(`[checkAvailability] Error for ${name}.${tld}:`, error);
    return {
      tld,
      full: domainToASCII(`${name}.${tld}`).toLowerCase(),
      status: "available",
      source: "error",
    };
  }
}

/** 辅助函数：查询 NS 记录 */
async function resolveNs(name: string): Promise<string[]> {
  const dns = await import("node:dns/promises");
  const results = await dns.resolveNs(name).catch(() => []);
  return results;
}