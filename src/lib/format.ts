export const ARKTOSHI = 100_000_000n;

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format an arktoshi amount as a decimal ARK string. */
export function formatArk(value: string | bigint | null | undefined, maxDecimals = 8, minDecimals = 2): string {
  if (value === null || value === undefined || value === "") return "0";
  let v = typeof value === "bigint" ? value : BigInt(value);
  const neg = v < 0n;
  if (neg) v = -v;
  const int = v / ARKTOSHI;
  let frac = (v % ARKTOSHI).toString().padStart(8, "0").slice(0, maxDecimals);
  frac = frac.replace(/0+$/, "");
  while (frac.length < Math.min(minDecimals, maxDecimals)) frac += "0";
  return (neg ? "-" : "") + group(int.toString()) + (frac ? "." + frac : "");
}

/** Parse a user-entered ARK amount into arktoshi. Returns null if invalid. */
export function parseArk(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*(\.\d{0,8})?$/.test(s) || s === "" || s === ".") return null;
  const [i, f = ""] = s.split(".");
  return BigInt(i || "0") * ARKTOSHI + BigInt((f + "00000000").slice(0, 8));
}

export function arkToNumber(v: string | bigint | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(typeof v === "bigint" ? v : BigInt(v)) / 1e8;
}

export function formatFiat(n: number, currency: string): string {
  const cur = currency.toUpperCase();
  try {
    if (cur === "BTC" || cur === "ETH") {
      return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 8 : 4 })} ${cur}`;
    }
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

export function shortAddress(a: string | null | undefined, n = 6): string {
  if (!a) return "";
  return a.length > n * 2 + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function timeAgo(unixSeconds: number): string {
  const d = Date.now() / 1000 - unixSeconds;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}
