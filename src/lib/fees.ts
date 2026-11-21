import type { NodeFeeConfig } from "./ark";
import type { TxKind } from "./types";
import { utf8Length } from "./format";

/** API / config key for each transaction kind */
export const FEE_KEY: Record<TxKind, string> = {
  transfer: "transfer",
  multipayment: "multiPayment",
  vote: "vote",
  secondSignature: "secondSignature",
  delegateRegistration: "delegateRegistration",
  delegateResignation: "delegateResignation",
};

export interface SizeParams {
  kind: TxKind;
  vendorField?: string;
  payments?: number;
  votes?: number;
  username?: string;
  hasSecondSignature?: boolean;
}

/**
 * Serialized size in bytes of a signed v2 transaction (Schnorr signatures).
 * Mirrors `formula_size` in src-tauri/src/tx.rs, which is tested against the real serializer.
 */
export function txSize(p: SizeParams): number {
  const memo = p.vendorField ? utf8Length(p.vendorField.trim()) : 0;
  const base = 59 + memo; // header(58) + vendor field length byte + memo bytes
  let asset = 0;
  switch (p.kind) {
    case "transfer":
      asset = 33;
      break;
    case "multipayment":
      asset = 2 + 29 * (p.payments ?? 0);
      break;
    case "vote":
      asset = 1 + 34 * (p.votes ?? 1);
      break;
    case "secondSignature":
      asset = 33;
      break;
    case "delegateRegistration":
      asset = 1 + utf8Length(p.username ?? "");
      break;
    case "delegateResignation":
      asset = 0;
      break;
  }
  return base + asset + 64 + (p.hasSecondSignature ? 64 : 0);
}

export interface FeeOptions {
  size: number;
  min: bigint;
  avg: bigint;
  /** true when the network has no recent fee data for this type and avg falls back to the static fee */
  avgIsStatic: boolean;
  static: bigint;
  max: bigint;
}

/**
 * Core v3 dynamic fee: (addonBytes[type] + round(serializedBytes / 2)) * satoshiPerByte.
 * The node requires fee >= this for both pool entry (minFeePool) and broadcast (minFeeBroadcast).
 */
export function feeOptions(cfg: NodeFeeConfig, p: SizeParams): FeeOptions {
  const key = FEE_KEY[p.kind];
  const size = txSize(p);
  const staticFee = BigInt(cfg.staticFees[key] ?? "10000000");
  let min: bigint;
  if (cfg.dynamicEnabled) {
    const perByte = Math.max(cfg.minFeePool, cfg.minFeeBroadcast, 1);
    const addon = cfg.addonBytes[key] ?? 0;
    min = BigInt(addon + Math.round(size / 2)) * BigInt(perByte);
    if (min < 1n) min = 1n;
  } else {
    min = staticFee;
  }
  const stat = cfg.stats[key];
  let avg = stat ? BigInt(stat.avg) : staticFee;
  const avgIsStatic = !stat;
  if (avg < min) avg = min;
  const max = stat ? (BigInt(stat.max) > staticFee ? BigInt(stat.max) : staticFee) : staticFee;
  return { size, min, avg, avgIsStatic, static: staticFee, max };
}
