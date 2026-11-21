/** Wallet identity colors, ordered so consecutive picks are far apart in hue. */
export const WALLET_COLORS = ["#73BFFF", "#E7B75F", "#C49BFF", "#8EE6A4", "#FF8FB8", "#FF9F5A", "#5FD4D0", "#D4E36A"];

/** Least-used color (first in palette order on ties). */
export function pickColor(used: (string | undefined)[]): string {
  const counts = new Map(WALLET_COLORS.map((c) => [c, 0]));
  for (const c of used) if (c && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  let best = WALLET_COLORS[0];
  for (const c of WALLET_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}

export function walletColor(w: { color?: string; address: string }): string {
  if (w.color) return w.color;
  let h = 0;
  for (let i = 0; i < w.address.length; i++) h = (h * 31 + w.address.charCodeAt(i)) >>> 0;
  return WALLET_COLORS[h % WALLET_COLORS.length];
}
