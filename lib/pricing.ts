export interface RegistrarPrice {
  registrar: string;
  /** 首年价格（USD/年） */
  firstYear: number;
  /** 续费价格（USD/年） */
  renewal: number;
  /** WHOIS 保护（USD/年），0 = 免费 */
  whoisProtection: number;
  /** 是否支持中国注册 */
  cn?: boolean;
  /** 不售卖的后缀（如厂商暂停某些 TLD） */
  excludeTlds?: string[];
  /** 首页 URL */
  homepage: string;
  /** 结算页 URL 模板，{domain} 会被替换 */
  checkoutTemplate: string;
  /** 价格备注（如促销说明） */
  note?: string;
}

const XN = "https://www.xinnet.com";
const ZH = "https://www.aliyun.com";

/** 价格快照（2026-08 从各注册商官网公开价采集，仅作参考，最终以注册商结算为准） */
export const REGISTRARS: RegistrarPrice[] = [
  {
    registrar: "Cloudflare",
    firstYear: 9.15,
    renewal: 9.15,
    whoisProtection: 0,
    excludeTlds: ["cn", "top"],
    homepage: "https://domains.cloudflare.com/",
    checkoutTemplate: "https://domains.cloudflare.com/?domain={domain}",
  },
  {
    registrar: "Porkbun",
    firstYear: 9.87,
    renewal: 9.87,
    whoisProtection: 0,
    excludeTlds: ["cn"],
    homepage: "https://porkbun.com",
    checkoutTemplate: "https://porkbun.com/checkout/search?q={domain}",
  },
  {
    registrar: "Namecheap",
    firstYear: 10.58,
    renewal: 10.98,
    whoisProtection: 0,
    homepage: "https://www.namecheap.com",
    checkoutTemplate: "https://www.namecheap.com/domains/domain-name-search/?domain={domain}",
  },
  {
    registrar: "GoDaddy",
    firstYear: 12.99,
    renewal: 21.99,
    whoisProtection: 9.99,
    homepage: "https://www.godaddy.com",
    checkoutTemplate: "https://www.godaddy.com/domainsearch/find?domainToCheck={domain}",
  },
  {
    registrar: "Dynadot",
    firstYear: 9.99,
    renewal: 11.99,
    whoisProtection: 0,
    homepage: "https://www.dynadot.com",
    checkoutTemplate: "https://www.dynadot.com/domain/checkout?domain={domain}",
  },
  {
    registrar: "Hostinger",
    firstYear: 8.99,
    renewal: 14.99,
    whoisProtection: 0,
    excludeTlds: ["cn"],
    homepage: "https://www.hostinger.com/domain-checker",
    checkoutTemplate: "https://www.hostinger.com/domain-checker",
  },
  {
    registrar: "Spaceship",
    firstYear: 9.75,
    renewal: 10.18,
    whoisProtection: 0,
    excludeTlds: ["cn"],
    homepage: "https://www.spaceship.com/domains",
    checkoutTemplate: "https://www.spaceship.com/domain-search/?tab=domains",
  },
  {
    registrar: "阿里云",
    firstYear: 0.99,
    renewal: 50,
    whoisProtection: 0,
    cn: true,
    homepage: ZH,
    checkoutTemplate: "https://wanwang.aliyun.com/domain/searchresult/?keyword={domain}",
    note: "首年促销价约 ¥7 起（活动价），续费约 ¥50/年；实际价格以结算页为准",
  },
  {
    registrar: "腾讯云",
    firstYear: 7.5,
    renewal: 12.0,
    whoisProtection: 0,
    cn: true,
    excludeTlds: ["co"],
    homepage: "https://cloud.tencent.com/product/domain",
    checkoutTemplate: "https://buy.cloud.tencent.com/domain?domain={domain}",
  },
  {
    registrar: "西部数码",
    firstYear: 7.2,
    renewal: 10.5,
    whoisProtection: 0.7,
    cn: true,
    homepage: "https://www.west.cn",
    checkoutTemplate: "https://www.west.cn/services/domain/",
  },
  {
    registrar: "新网",
    firstYear: 7.6,
    renewal: 8.5,
    whoisProtection: 0,
    cn: true,
    homepage: XN,
    checkoutTemplate: "https://www.xinnet.com/domain/price.html",
  },
];

export const XINNET_TLDS: string[] = [
  "cn",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "com",
  "net",
  "org",
  "top",
  "vip",
  "site",
  "tech",
  "xyz",
  "cc",
  "tv",
  "info",
  "me",
  "co",
  "pro",
  "store",
  "online",
  "club",
];

export function checkoutUrl(
  registrar: RegistrarPrice,
  full: string
): string {
  return registrar.checkoutTemplate.replace("{domain}", full);
}

export function cheapestFirstYear(tld: string): RegistrarPrice | null {
  const candidates = REGISTRARS.filter((r) => {
    if (r.excludeTlds?.includes(tld)) return false;
    if (r.cn) return true;
    return !["cn", "com.cn", "net.cn", "org.cn"].includes(tld);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((min, r) =>
    r.firstYear < min.firstYear ? r : min
  );
}

export { XN };