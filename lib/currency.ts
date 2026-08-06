export type CurrencyCode = "USD" | "CNY";

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  CNY: "¥",
};

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: "美元 USD",
  CNY: "人民币 CNY",
};

export const DEFAULT_USD_TO_CNY_RATE = 7.2;

export function convertPrice(
  usd: number,
  currency: CurrencyCode,
  rate: number
): number {
  if (currency === "CNY") return usd * rate;
  return usd;
}

export function formatPrice(
  usd: number,
  currency: CurrencyCode,
  rate: number
): string {
  const value = convertPrice(usd, currency, rate);
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === "USD") return `${symbol}${value.toFixed(2)}`;
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${symbol}${value.toFixed(decimals)}`;
}