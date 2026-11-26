// Exchange ARK to USDC or USDT (ported from drain). The exchange Worker (built-in URL, see src-tauri lib.rs) holds the
// aggregator API keys and only quotes and creates orders; this side checks every order itself (drain's
// check_order), signs the ARK transfer locally, and links to the exchange's own order page for status (drain's
// tracking()). Nothing here trusts the Worker for where the coins go: the payout address comes from your
// address book and the order must match it.
import { invoke } from "@tauri-apps/api/core";
import { backend, type HttpResponse } from "./backend";
import { app } from "./state.svelte";
import { NETWORKS } from "./types";

export interface DrainQuote {
  service: "Flashift" | "Trocador";
  provider: string;
  rateType: "fixed" | "floating";
  amountTo: string;
  networkTo: string;
  ref: Record<string, unknown>;
  kyc?: string;
  tags?: string[];
  /** first choice of its own service (Flashift's tag priority, Trocador's best payout) */
  servicePick?: boolean;
  /** picked by default (first by drain's ranking) */
  best?: boolean;
}

export interface DrainOrder {
  service: "Flashift" | "Trocador";
  provider: string;
  orderId: string;
  providerOrderId: string;
  depositAddress: string;
  depositMemo: string;
  payoutAddress: string;
  amountTo: string | null;
  amountFrom: string | null;
  symbolTo: string;
  networkTo: string;
}

export const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** Stablecoins you can receive. */
export const COINS = [
  { id: "usdc", name: "USDC" },
  { id: "usdt", name: "USDT" },
] as const;
export type Coin = (typeof COINS)[number]["id"];
export function coinName(id: string | undefined): string {
  return (COINS.find((c) => c.id === id) ?? COINS[0]).name;
}
export function coinOf(id: string | undefined): Coin {
  return (COINS.find((c) => c.id === id) ?? COINS[0]).id;
}

/**
 * Payout networks: EVM chains, so the same 0x address works on all of them, and the coins offered there for ARK
 * (neither aggregator has ARK to USDT on Base). Ids match the Worker.
 */
export const PAYOUT_NETWORKS = [
  { id: "polygon", name: "Polygon", explorer: "https://polygonscan.com", coins: ["usdc", "usdt"] },
  { id: "base", name: "Base", explorer: "https://basescan.org", coins: ["usdc"] },
  { id: "ethereum", name: "Ethereum", explorer: "https://etherscan.io", coins: ["usdc", "usdt"] },
  { id: "arbitrum", name: "Arbitrum", explorer: "https://arbiscan.io", coins: ["usdc", "usdt"] },
  { id: "optimism", name: "Optimism", explorer: "https://optimistic.etherscan.io", coins: ["usdc", "usdt"] },
  { id: "bsc", name: "BNB Chain", explorer: "https://bscscan.com", coins: ["usdc", "usdt"] },
] as const;
export type PayoutNetwork = (typeof PAYOUT_NETWORKS)[number]["id"];

// No longer offered: still named and linked for old address book entries and history.
const RETIRED_NETWORKS: { id: string; name: string; explorer: string }[] = [
  { id: "avalanche", name: "Avalanche", explorer: "https://snowtrace.io" },
];

/** Network info by id; missing ids are Polygon (records from before networks were stored). */
export function payoutNetwork(id: string | undefined): { id: string; name: string; explorer: string } {
  return PAYOUT_NETWORKS.find((n) => n.id === (id || "polygon")) ?? RETIRED_NETWORKS.find((n) => n.id === id) ?? PAYOUT_NETWORKS[0];
}

/** Whether this coin is offered on this network right now. */
export function isOffered(coin: string | undefined, network: string | undefined): boolean {
  return PAYOUT_CHOICES.some((c) => c.coin === coinOf(coin) && c.network === (network || "polygon"));
}

/** Every coin + network pair offered, for the combined pickers (value "usdc:polygon"). */
export const PAYOUT_CHOICES = COINS.flatMap((c) =>
  PAYOUT_NETWORKS.filter((n) => (n.coins as readonly string[]).includes(c.id)).map((n) => ({
    value: `${c.id}:${n.id}`,
    coin: c.id as Coin,
    network: n.id as PayoutNetwork,
    label: `${c.name} · ${n.name}`,
  })),
);
export function parseChoice(value: string): { coin: Coin; network: PayoutNetwork } {
  const c = PAYOUT_CHOICES.find((x) => x.value === value) ?? PAYOUT_CHOICES[0];
  return { coin: c.coin, network: c.network };
}
export function choiceLabel(coin: string | undefined, network: string | undefined): string {
  return `${coinName(coin)} · ${payoutNetwork(network).name}`;
}

async function call<T>(path: "/health" | "/quote" | "/order", body: unknown): Promise<T> {
  const r = await invoke<HttpResponse>("exchange_post", { path, body });
  if (r.status !== 200) {
    const msg = typeof r.body === "object" && r.body && "error" in (r.body as any) ? String((r.body as any).error) : "";
    if (r.status === 429) {
      // the Worker protects itself (per-IP limit) and the aggregators' ~20 requests/min key limits
      const err = new Error(msg || "Too many requests: try again shortly") as Error & { retryAfter?: number };
      err.retryAfter = Number((r.body as any)?.retryAfter ?? r.retryAfter ?? 10) || 10;
      throw err;
    }
    throw new Error(msg ? `Exchange service: ${msg}` : `Exchange service error ${r.status}`);
  }
  return r.body as T;
}

/** EIP-55: "invalid" | "unchecked" (one case, nothing to verify) | "ok" | "bad-checksum" (typo) */
export const evmAddressCheck = (address: string) =>
  invoke<"invalid" | "unchecked" | "ok" | "bad-checksum">("evm_address_check", { address });

export const drain = {
  health: () => call<{ ok: boolean; services: string[]; rate: string }>("/health", {}),
  quote: (amount: string, network: PayoutNetwork, coin: Coin) =>
    call<{ amount: string; network: string; coin: Coin; quotes: DrainQuote[]; errors: { service: string; message: string }[]; cached?: boolean; at?: number }>(
      "/quote",
      { amount, network, coin },
    ),
  order: (amount: string, network: PayoutNetwork, coin: Coin, quote: DrainQuote, payoutAddress: string, refundAddress: string) =>
    call<{ order: DrainOrder }>("/order", { amount, network, coin, quote, payoutAddress, refundAddress }),
};

/** arktoshi -> "123.45" (no grouping, trailing zeros trimmed) */
export function toCoins(arktoshi: bigint): string {
  const whole = arktoshi / 100_000_000n;
  const frac = (arktoshi % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * drain sends the whole amount to the deposit address, so be strict about what is accepted.
 * Returns the problems found; an empty list means the order may be funded.
 */
export async function checkOrder(o: DrainOrder, amount: string, quote: DrainQuote, payout: string, coin: Coin): Promise<string[]> {
  const want = coinName(coin);
  const bad: string[] = [];
  if (!o.orderId || o.orderId === "None") bad.push("The order has no id");
  if (!(await backend.validateAddress(o.depositAddress, NETWORKS.mainnet.pubKeyHash)))
    bad.push(`The deposit address is not a valid ARK address: ${o.depositAddress || "(empty)"}`);
  if (app.wallets.some((w) => w.address === o.depositAddress)) bad.push("The deposit address is one of your own wallets");
  const memo = (o.depositMemo || "").trim();
  if (memo && !["0", "None", "null"].includes(memo)) bad.push(`The deposit needs a memo (${memo}), which this transfer does not send`);
  if (o.payoutAddress.trim().toLowerCase() !== payout.trim().toLowerCase())
    bad.push(`The order pays out to ${o.payoutAddress || "(empty)"}, not your payout address`);
  if (o.amountFrom !== null && o.amountFrom !== "") {
    const reported = Number(o.amountFrom);
    if (!Number.isFinite(reported) || Math.abs(reported - Number(amount)) > 0.0001)
      bad.push(`The order is for ${o.amountFrom} ARK, not ${amount}`);
  }
  if (o.symbolTo && o.symbolTo.toLowerCase() !== coin) bad.push(`The order pays out ${o.symbolTo}, not ${want}`);
  if (o.networkTo && quote.networkTo && o.networkTo.toLowerCase() !== quote.networkTo.toLowerCase())
    bad.push(`The order pays out on ${o.networkTo}, not ${quote.networkTo}`);
  if (o.amountTo !== null && o.amountTo !== "" && Number(o.amountTo) < Number(quote.amountTo) * 0.97)
    bad.push(`The order pays ~${o.amountTo} ${want}, more than 3% below the quote of ${quote.amountTo}`);
  return bad;
}

// Order pages on the exchanges themselves (same table as drain; each checked there with a real unfunded order).
const EXCHANGE_TRACKING: Record<string, string> = {
  changelly: "https://changelly.com/track/{id}",
  changenow: "https://changenow.io/exchange/txs/{id}",
  simpleswap: "https://simpleswap.io/exchange?id={id}",
  stealthex: "https://stealthex.io/exchange/?id={id}",
};

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface Tracking {
  label: string;
  url: string;
  /** extra steps when the site has no page per order */
  note?: string;
}

/** Where the order's status can be followed: the exchange's own page when known, otherwise the aggregator's. */
export function tracking(r: { service: string; provider: string; orderId: string; providerOrderId: string }): Tracking | null {
  const tpl = EXCHANGE_TRACKING[norm(r.provider)];
  if (tpl && r.providerOrderId) return { label: r.provider, url: tpl.replace("{id}", encodeURIComponent(r.providerOrderId)) };
  if (r.service === "Trocador") return { label: "Trocador", url: `https://trocador.app/checkout/${encodeURIComponent(r.orderId)}` };
  if (r.service === "Flashift")
    return { label: "Flashift", url: "https://exchange.flashift.app", note: `History → Track Your Swap → ${r.orderId}` };
  return null;
}

/** The payout address's token transfers on that chain's explorer: the coins arriving, straight from the chain. */
export function payoutLink(address: string, network?: string): string {
  const n = payoutNetwork(network);
  return `${n.explorer}/address/${address}#tokentxns`;
}
