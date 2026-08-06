export interface TldInfo {
  tld: string;
  label: string;
  popular?: boolean;
  china?: boolean;
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
];