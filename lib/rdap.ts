import { domainToASCII } from "node:url";
import { resolveAny } from "node:dns/promises";

export type AvailabilityStatus = "available" | "registered" | "unknown";

export interface AvailabilityResult {
  tld: string;
  full: string;
  status: AvailabilityStatus;
  registrar?: string | null;
  expiry?: string | null;
  source: "rdap" | "dns" | "none";
  error?: string | null;
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
): { registrar?: string; expiry?: string } {
  let registrar: string | undefined;
  let expiry: string | undefined;
  try {
    const obj = data as {
      entities?: { vcardArray?: [string, unknown[][]] }[];
      events?: { eventAction?: string; eventDate?: string }[];
    };
    for (const entity of obj.entities ?? []) {
      if (!registrar && Array.isArray(entity.vcardArray)) {
        const vcard = entity.vcardArray[1];
        if (Array.isArray(vcard)) {
          for (const row of vcard) {
            if (Array.isArray(row) && row[0] === "fn" && row[2] !== undefined) {
              // jCard 格式: [name, params, 值类型("text"), 值]
              registrar = String(row[3] ?? row[2] ?? "");
              break;
            }
          }
        }
      }
    }
    for (const event of obj.events ?? []) {
      const action = event.eventAction ?? "";
      if (
        action === "expiration" ||
        action === "registration expiration" ||
        action === "registration_expiration"
      ) {
        expiry = event.eventDate;
        break;
      }
    }
  } catch {
    // 解析失败不影响主流程
  }
  return { registrar, expiry };
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
        const { registrar, expiry } = parseRdap(data);
        return {
          tld,
          full,
          status: "registered",
          registrar: registrar ?? null,
          expiry: expiry ?? null,
          source: "rdap",
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