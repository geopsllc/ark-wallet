import type { ApiTransaction } from "./types";
import { sameAddress as same } from "./chain";
import { MS_GROUP, MS_TYPE } from "./mainsail";

/** How a transaction looks from the point of view of wallet `me`. */
export interface TxRow {
  label: string;
  icon: string;
  dir: "in" | "out" | "self" | "other";
  amount: bigint; // signed, excluding fee
  counterparty?: string;
  votes?: string[];
}

export function describeTx(t: ApiTransaction, me: string): TxRow {
  const out = same(t.sender, me);
  const amt = BigInt(t.amount ?? "0");
  const row = describe(t, me, out, amt);
  return t.failed ? { ...row, label: `${row.label} · failed`, icon: "x", amount: 0n } : row;
}

function describe(t: ApiTransaction, me: string, out: boolean, amt: bigint): TxRow {
  const who = "Validator";
  if (t.evm && t.typeGroup === MS_GROUP) {
    switch (t.type) {
      case MS_TYPE.validatorUpdate:
        return { label: "Validator key update", icon: "key", dir: "other", amount: 0n };
      case MS_TYPE.usernameRegistration:
        return { label: `Username: ${t.asset?.username ?? ""}`, icon: "edit", dir: "other", amount: 0n };
      case MS_TYPE.usernameResignation:
        return { label: "Username resignation", icon: "x", dir: "other", amount: 0n };
      default:
        return out
          ? { label: "Contract call", icon: "layers", dir: "out", amount: -amt, counterparty: t.recipient }
          : { label: "Contract call", icon: "layers", dir: "in", amount: amt, counterparty: t.sender };
    }
  }
  if (t.typeGroup === 1) {
    switch (t.type) {
      case 0: {
        if (out && same(t.recipient, me)) return { label: "Transfer to self", icon: "swap", dir: "self", amount: 0n, counterparty: me };
        return out
          ? { label: "Sent", icon: "send", dir: "out", amount: -amt, counterparty: t.recipient }
          : { label: "Received", icon: "receive", dir: "in", amount: amt, counterparty: t.sender };
      }
      case 6: {
        const payments: { amount: string; recipientId: string }[] = t.asset?.payments ?? [];
        if (out) {
          const sum = payments.reduce((s, p) => s + BigInt(p.amount), 0n);
          const toSelf = payments.filter((p) => same(p.recipientId, me)).reduce((s, p) => s + BigInt(p.amount), 0n);
          return { label: `Multipayment (${payments.length})`, icon: "users", dir: "out", amount: -(sum - toSelf) };
        }
        const mine = payments.filter((p) => same(p.recipientId, me)).reduce((s, p) => s + BigInt(p.amount), 0n);
        return { label: "Multipayment received", icon: "receive", dir: "in", amount: mine, counterparty: t.sender };
      }
      case 3: {
        const votes: string[] = t.asset?.votes ?? [];
        const label = votes.length === 2 ? "Switch vote" : votes[0]?.startsWith("+") ? "Vote" : "Unvote";
        // Mainsail: vote() also replaces an earlier vote in the same transaction
        return { label, icon: "vote", dir: "other", amount: 0n, votes };
      }
      case 1:
        return { label: "Second passphrase", icon: "key", dir: "other", amount: 0n };
      case 2:
        // Mainsail locks the registration amount in the consensus contract
        if (t.evm) return { label: "Validator registration", icon: "star", dir: "out", amount: -amt };
        return { label: `Validator registration: ${t.asset?.delegate?.username ?? ""}`, icon: "star", dir: "other", amount: 0n };
      case 7:
        return { label: `${who} resignation`, icon: "x", dir: "other", amount: t.evm ? amt : 0n };
      case 4:
        return { label: "Multisignature", icon: "users", dir: "other", amount: 0n };
      case 5:
        return { label: "IPFS", icon: "layers", dir: "other", amount: 0n };
      case 8:
      case 9:
      case 10:
        return { label: ["HTLC lock", "HTLC claim", "HTLC refund"][t.type - 8], icon: "lock", dir: out ? "out" : "in", amount: out ? -amt : amt };
    }
  }
  return { label: `Type ${t.typeGroup}/${t.type}`, icon: "layers", dir: "other", amount: out ? -amt : amt };
}

/** True when the transaction touches `address` (sender, recipient or multipayment recipient). */
export function involves(t: ApiTransaction, address: string): boolean {
  if (same(t.sender, address) || same(t.recipient, address)) return true;
  const payments: { recipientId: string }[] = t.asset?.payments ?? [];
  return payments.some((p) => same(p.recipientId, address));
}
