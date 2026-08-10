export interface TldInfo {
  tld: string;
  label: string;
  popular?: boolean;
  china?: boolean;
  price?: { firstYear: number; renewal: number };
}

export const TLDS: TldInfo[] = [
  { tld: "com", label: ".com", popular: true },
  { tld: "net", label: ".net", popular: true },
  { tld: "org", label: ".org", popular: true },
  { tld: "io", label: ".io", popular: true },
  { tld: "co", label: ".co" },
  { tld: "xyz", label: ".xyz", popular: true },
  { tld: "cn", label: ".cn", popular: true, china: true },
  { tld: "top", label: ".top" },
  { tld: "dev", label: ".dev" },
  { tld: "app", label: ".app" },
  { tld: "me", label: ".me" },
  { tld: "info", label: ".info" },
  { tld: "cc", label: ".cc" },
  { tld: "tv", label: ".tv" },
  { tld: "site", label: ".site" },
  { tld: "tech", label: ".tech" },
  { tld: "vip", label: ".vip" },
  { tld: "pro", label: ".pro" },
  { tld: "store", label: ".store" },
  { tld: "online", label: ".online" },
  { tld: "space", label: ".space" },
  { tld: "club", label: ".club" },
];

export const DEFAULT_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "xyz",
  "cn",
  "top",
  "dev",
  "app",
  "me",
  "info",
  "cc",
  "tv",
  "site",
  "tech",
  "vip",
  "store",
  "online",
  "space",
  "club",
];

export const TLD_PRICES: Record<string, { firstYear: number; renewal: number }> = {
  com: { firstYear: 8.88, renewal: 12.98 },
  net: { firstYear: 11.99, renewal: 14.98 },
  org: { firstYear: 10.99, renewal: 13.98 },
  io: { firstYear: 32.88, renewal: 40.88 },
  co: { firstYear: 26.99, renewal: 28.99 },
  xyz: { firstYear: 1.99, renewal: 12.98 },
  cn: { firstYear: 29.00, renewal: 55.00 },
  top: { firstYear: 1.99, renewal: 14.99 },
  dev: { firstYear: 10.99, renewal: 12.99 },
  app: { firstYear: 16.99, renewal: 18.99 },
  me: { firstYear: 17.99, renewal: 19.99 },
  info: { firstYear: 10.99, renewal: 12.99 },
  cc: { firstYear: 14.99, renewal: 19.99 },
  tv: { firstYear: 29.99, renewal: 29.99 },
  site: { firstYear: 1.99, renewal: 29.99 },
  tech: { firstYear: 4.99, renewal: 49.99 },
  vip: { firstYear: 4.88, renewal: 19.88 },
  pro: { firstYear: 9.99, renewal: 14.99 },
  store: { firstYear: 3.99, renewal: 49.99 },
  online: { firstYear: 2.99, renewal: 39.99 },
  space: { firstYear: 1.99, renewal: 24.99 },
  club: { firstYear: 2.99, renewal: 19.99 },
};

export function getTldPrice(tld: string): { firstYear: number; renewal: number } | null {
  return TLD_PRICES[tld] || null;
}
