import { Resolver } from "node:dns/promises";

const resolver = new Resolver();
resolver.setServers([
  "1.1.1.1",
  "1.0.0.1",
  "8.8.8.8",
  "8.8.4.4",
  "9.9.9.9",
]);

const DNS_TIMEOUT_MS = 3000;
const RDAP_TIMEOUT_MS = 4000;

export type ScanStatus = "available" | "registered" | "unknown";

async function dnsLookup(
  name: string
): Promise<"available" | "registered" | "error"> {
  try {
    const records = await Promise.race([
      resolver.resolveNs(name),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS)
      ),
    ]);
    return records.length > 0 ? "registered" : "available";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (
      code === "ENOTFOUND" ||
      code === "ENODATA" ||
      code === "ENOTEMPTY" ||
      code === "NXDOMAIN"
    ) {
      return "available";
    }
    return "error";
  }
}

async function rdapFallback(
  full: string,
  tld: string
): Promise<"available" | "registered" | "error"> {
  const endpoints =
    tld === "xyz"
      ? [
          `https://rdap.centralnic.com/xyz/domain/${full}`,
          `https://rdap.org/domain/${full}`,
        ]
      : [`https://rdap.org/domain/${full}`];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { accept: "application/rdap+json, application/json" },
        });
        if (res.status === 404) return "available";
        if (res.status === 200) return "registered";
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 尝试下一个端点
    }
  }
  return "error";
}

/**
 * 扫描专用快速检测：
 * 1) DNS NS 查询（1.1.1.1/8.8.8.8，~10-50ms）——NXDOMAIN 即未注册，直接判定；
 * 2) DNS 失败才降级 RDAP（xyz 直连 centralnic 再 rdap.org），只读状态码不解析正文。
 */
export async function fastScanAvailability(
  name: string,
  tld: string
): Promise<ScanStatus> {
  const dnsResult = await dnsLookup(`${name}.${tld}`);
  if (dnsResult !== "error") return dnsResult;
  const rdapResult = await rdapFallback(`${name}.${tld}`, tld);
  if (rdapResult !== "error") return rdapResult;
  return "unknown";
}