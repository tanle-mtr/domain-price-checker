import { domainToASCII } from "node:url";
import { resolveAny } from "node:dns/promises";

export type AvailabilityStatus = "available" | "registered" | "unknown";

export interface WhoisInfo {
  registrar?: string | null;
  registrarUrl?: string | null;
  creationDate?: string | null;
  expiryDate?: string | null;
  updatedDate?: string | null;
  nameservers?: string[] | null;
  status?: string[] | null;
  registryDomainId?: string | null;
}

export interface AvailabilityResult {
  tld: string;
  full: string;
  status: AvailabilityStatus;
  registrar?: string | null;
  expiry?: string | null;
  source: "rdap" | "dns" | "none";
  error?: string | null;
  whois?: WhoisInfo | null;
}

const RDAP_TIMEOUT_MS = 6500;
const DNS_TIMEOUT_MS = 3500;

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

export async function checkAvailability(
  name: string,
  tld: string
): Promise<AvailabilityResult> {
  const full = domainToASCII(`${name}.${tld}`).toLowerCase();

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

  try {
    const records = await Promise.race([
      resolveAny(full),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS)
      ),
    ]);
    if (records && records.length > 0) {
      return { tld, full, status: "registered", source: "dns" };
    }
    return { tld, full, status: "available", source: "dns" };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT" || code === "ENODATA" || code === "ENOTFOUND") {
      return { tld, full, status: "available", source: "dns" };
    }
    return {
      tld,
      full,
      status: "unknown",
      source: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}