import { domainToASCII } from "node:url";

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
  whois?: WhoisInfo | null;
}

const RDAP_TIMEOUT_MS = 8000;
const DNS_TIMEOUT_MS = 4000;
const WHOIS_TIMEOUT_MS = 6000;

const RDAP_DIRECT: Record<string, string[]> = {
  com: ["https://rdap.verisign.com/com/v1/"],
  net: ["https://rdap.verisign.com/net/v1/"],
  org: ["https://rdap.publicinterestregistry.org/rdap/"],
  xyz: ["https://rdap.centralnic.com/xyz/"],
  cn: ["https://rdap.cnnic.cn/"],
  io: ["https://rdap.nic.io/"],
  co: ["https://rdap.nic.co/"],
  me: ["https://rdap.nic.me/"],
  tv: ["https://rdap.nic.tv/"],
  dev: ["https://pubapi.registry.google/rdap/"],
  app: ["https://pubapi.registry.google/rdap/"],
  top: ["https://rdap.verisign.com/top/v1/"],
  site: ["https://rdap.afilias.net/sit/"],
  tech: ["https://rdap.publicinterestregistry.org/rdap/"],
  cc: ["https://www.nic.cc/rdap/domain/"],
  info: ["https://rdap.verisign.com/info/v1/"],
  vip: ["https://rdap.verisign.com/vip/v1/"],
  store: ["https://rdap.verisign.com/store/v1/"],
  online: ["https://rdap.verisign.com/online/v1/"],
  space: ["https://rdap.verisign.com/space/v1/"],
  club: ["https://rdap.verisign.com/club/v1/"],
  pro: ["https://rdap.verisign.com/pro/v1/"],
};

const WHOIS_SERVERS: Record<string, string> = {
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.pir.org",
  xyz: "whois.centralnic.com",
  cn: "whois.cnnic.cn",
  io: "whois.nic.io",
  co: "whois.nic.co",
  me: "whois.nic.me",
  tv: "whois.nic.tv",
  dev: "whois.nic.dev",
  app: "whois.nic.app",
  top: "whois.verisign-grs.com",
  site: "whois.afilias.net",
  tech: "whois.pir.org",
  cc: "whois.nic.cc",
  info: "whois.verisign-grs.com",
  vip: "whois.verisign-grs.com",
  store: "whois.verisign-grs.com",
  online: "whois.verisign-grs.com",
  space: "whois.verisign-grs.com",
  club: "whois.nic.club",
  pro: "whois.nic.pro",
};

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/rdap+json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function whoisTcpQuery(domain: string, server: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
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

    client.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

function parseRdapData(data: any): WhoisInfo {
  if (!data) return {};
  
  const info: WhoisInfo = {};
  
  try {
    // Parse events (dates)
    for (const event of data.events ?? []) {
      const action = event.eventAction ?? "";
      const date = event.eventDate;
      if (!date) continue;
      
      if (action.includes("creation") || action.includes("registration")) {
        info.creationDate = new Date(date).toISOString().slice(0, 10);
      } else if (action.includes("expir")) {
        info.expiryDate = new Date(date).toISOString().slice(0, 10);
      } else if (action.includes("update") || action.includes("changed")) {
        info.updatedDate = new Date(date).toISOString().slice(0, 10);
      }
    }
    
    // Parse registrar from entities
    for (const entity of data.entities ?? []) {
      const roles = entity.roles ?? [];
      if (roles.includes("registrar")) {
        const vcard = entity.vcardArray;
        if (vcard?.[1]) {
          const fn = vcard[1].find((f: any[]) => f?.[0] === "fn");
          if (fn?.[3]) info.registrar = String(fn[3]);
        }
      }
    }
    
    // Parse nameservers
    if (data.nameservers?.length) {
      info.nameservers = data.nameservers
        .map((ns: any) => ns.ldhName)
        .filter(Boolean);
    }
    
    // Parse status
    if (data.status?.length) {
      info.status = data.status;
    }
    
    // Parse handle
    if (data.handle) {
      info.registryDomainId = data.handle;
    }
  } catch {
    // Ignore parse errors
  }
  
  return info;
}

function parseWhoisText(data: string): { status: AvailabilityStatus; info: WhoisInfo } {
  const info: WhoisInfo = { rawText: data.slice(0, 2000) };
  
  if (!data) {
    return { status: "available", info };
  }
  
  // Check if domain is available
  const availablePatterns = [
    /No match for/i,
    /NOT FOUND/i,
    /is free/i,
    /unregistered/i,
    /No Data Found/i,
    /No entries found/i,
    /status: free/i,
  ];
  
  for (const pattern of availablePatterns) {
    if (pattern.test(data)) {
      return { status: "available", info };
    }
  }
  
  // Parse WHOIS fields
  const lines = data.split(/\r?\n/);
  let lastKey = "";
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      if (lastKey && info.nameservers) {
        info.nameservers.push(trimmed);
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
    
    if (key.includes("registrar") && !info.registrar) {
      info.registrar = value.replace(/\s*\([^)]*\)/g, "").trim();
    }
    if (key.includes("registrar url") || key.includes("registrar www")) {
      info.registrarUrl = value;
    }
    if (key.includes("creation") || key.includes("created") || key.includes("registration date")) {
      info.creationDate = value.slice(0, 10);
    }
    if (key.includes("expir") || key.includes("expire")) {
      info.expiryDate = value.slice(0, 10);
    }
    if (key.includes("updated") || key.includes("last update")) {
      info.updatedDate = value.slice(0, 10);
    }
    if (key.includes("nameserver") || key.match(/^ns\d*$/)) {
      if (!info.nameservers) info.nameservers = [];
      info.nameservers.push(value);
    }
    if (key.includes("status")) {
      info.status = value.split(/[,\s]+/).filter(Boolean);
    }
    if (key.includes("registry domain id") || key.includes("domain id")) {
      info.registryDomainId = value;
    }
  }
  
  // If we found any meaningful data, it's registered
  if (info.registrar || info.creationDate || info.expiryDate || info.nameservers?.length) {
    return { status: "registered", info };
  }
  
  return { status: "available", info };
}

export async function checkDomain(name: string, tld: string): Promise<AvailabilityResult> {
  const full = domainToASCII(`${name}.${tld}`).toLowerCase();
  
  // Try RDAP first
  const rdapUrls = [
    `https://rdap.org/domain/${full}`,
    ...(RDAP_DIRECT[tld] ?? []).map((base) => `${base}${full}`),
  ];
  
  for (const url of rdapUrls) {
    try {
      const res = await fetchWithTimeout(url, RDAP_TIMEOUT_MS);
      if (res.status === 200) {
        const data = await res.json().catch(() => null);
        if (data) {
          const whois = parseRdapData(data);
          return {
            tld,
            full,
            status: "registered",
            registrar: whois.registrar,
            expiry: whois.expiryDate,
            source: "rdap",
            whois,
          };
        }
      }
      if (res.status === 404) {
        return { tld, full, status: "available", source: "rdap" };
      }
    } catch {
      // Try next endpoint
    }
  }
  
  // Try TCP WHOIS
  const whoisServer = WHOIS_SERVERS[tld] || "whois.internic.net";
  try {
    const whoisData = await whoisTcpQuery(full, whoisServer);
    const { status, info } = parseWhoisText(whoisData);
    return {
      tld,
      full,
      status,
      registrar: info.registrar,
      expiry: info.expiryDate,
      source: "whois",
      whois: info.rawText ? info : null,
    };
  } catch {
    // WHOIS failed, continue
  }
  
  // Fallback to DNS
  try {
    const dns = require("node:dns/promises");
    const [aRecords, nsRecords] = await Promise.all([
      dns.resolve4(full).catch(() => []),
      dns.resolveNs(full).catch(() => []),
    ]);
    
    if (aRecords.length > 0 || nsRecords.length > 0) {
      return { tld, full, status: "registered", source: "dns" };
    }
    return { tld, full, status: "available", source: "dns" };
  } catch {
    // DNS failed
  }
  
  // Final fallback
  return { tld, full, status: "available", source: "fallback" };
}
