import type { ApiTransaction } from "./types";

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
  const out = t.sender === me;
  const amt = BigInt(t.amount ?? "0");
  if (t.typeGroup === 1) {
    switch (t.type) {
      case 0: {
        if (out && t.recipient === me) return { label: "Transfer to self", icon: "swap", dir: "self", amount: 0n, counterparty: me };
        return out
          ? { label: "Sent", icon: "send", dir: "out", amount: -amt, counterparty: t.recipient }
          : { label: "Received", icon: "receive", dir: "in", amount: amt, counterparty: t.sender };
      }
      case 6: {
        const payments: { amount: string; recipientId: string }[] = t.asset?.payments ?? [];
        if (out) {
          const sum = payments.reduce((s, p) => s + BigInt(p.amount), 0n);
          const toSelf = payments.filter((p) => p.recipientId === me).reduce((s, p) => s + BigInt(p.amount), 0n);
          return { label: `Multipayment (${payments.length})`, icon: "users", dir: "out", amount: -(sum - toSelf) };
        }
        const mine = payments.filter((p) => p.recipientId === me).reduce((s, p) => s + BigInt(p.amount), 0n);
        return { label: "Multipayment received", icon: "receive", dir: "in", amount: mine, counterparty: t.sender };
      }
      case 3: {
        const votes: string[] = t.asset?.votes ?? [];
        const label = votes.length === 2 ? "Switch vote" : votes[0]?.startsWith("+") ? "Vote" : "Unvote";
        return { label, icon: "vote", dir: "other", amount: 0n, votes };
      }
      case 1:
        return { label: "Second passphrase", icon: "key", dir: "other", amount: 0n };
      case 2:
        return { label: `Delegate registration: ${t.asset?.delegate?.username ?? ""}`, icon: "star", dir: "other", amount: 0n };
      case 7:
        return { label: "Delegate resignation", icon: "x", dir: "other", amount: 0n };
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
  if (t.sender === address || t.recipient === address) return true;
  const payments: { recipientId: string }[] = t.asset?.payments ?? [];
  return payments.some((p) => p.recipientId === address);
}
