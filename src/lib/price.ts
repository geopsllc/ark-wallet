import { backend } from "./backend";

const CG = "https://api.coingecko.com/api/v3";

export const CURRENCIES = ["usd", "eur", "gbp", "chf", "cad", "aud", "jpy", "cny", "krw", "inr", "brl", "rub", "btc", "eth"];

export interface PriceInfo {
  price: number;
  change24h: number;
  marketCap?: number;
  volume24h?: number;
  currency: string;
  at: number;
}

export async function fetchPrice(currency: string): Promise<PriceInfo> {
  const url = `${CG}/simple/price?ids=ark&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const res = await backend.httpGet(url);
  if (res.status !== 200) throw new Error(`CoinGecko returned ${res.status}`);
  const d = res.body?.ark ?? {};
  return {
    price: d[currency] ?? 0,
    change24h: d[`${currency}_24h_change`] ?? 0,
    marketCap: d[`${currency}_market_cap`],
    volume24h: d[`${currency}_24h_vol`],
    currency,
    at: Date.now(),
  };
}

/** [unixMs, price][] for the last `days` days */
export async function fetchHistory(currency: string, days = 7): Promise<[number, number][]> {
  const res = await backend.httpGet(`${CG}/coins/ark/market_chart?vs_currency=${currency}&days=${days}`);
  if (res.status !== 200) throw new Error(`CoinGecko returned ${res.status}`);
  return res.body?.prices ?? [];
}
