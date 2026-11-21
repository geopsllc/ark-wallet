/** Per-wallet identity colors (stable: derived from the address). Blue/green-led, with a few extras. */
export const WALLET_COLORS = ["#73BFFF", "#8EE6A4", "#E7B75F", "#C49BFF", "#5FD4D0", "#FF9EC7", "#FFB07A", "#9DB4FF"];

export function walletColor(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return WALLET_COLORS[h % WALLET_COLORS.length];
}
