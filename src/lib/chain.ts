// One entry point per network: Core v3 (ark.ts) or Mainsail (mainsail.ts). Both clients take the
// API base first and return the same shapes, so screens call chain(network).x(app.apiUrl(network), …).
import { ark } from "./ark";
import { ms } from "./mainsail";
import { backend } from "./backend";
import { NETWORKS, type NetworkId } from "./types";

type Common = Pick<typeof ark, "wallet" | "transactions" | "delegates" | "delegate" | "addressName" | "tipHeight" | "blocksInRange" | "blockTransactions">;

export function chain(network: NetworkId): Common {
  return NETWORKS[network].family === "mainsail" ? ms : ark;
}

/** Address and public key a passphrase controls on this network. */
export function deriveWallet(network: NetworkId, passphrase: string) {
  const n = NETWORKS[network];
  return n.family === "mainsail" ? backend.msDeriveWallet(passphrase) : backend.deriveWallet(passphrase, n.pubKeyHash);
}

/** The address in its canonical form (EIP-55 for 0x addresses), or null when it is not valid on this network. */
export async function normalizeAddress(network: NetworkId, address: string): Promise<string | null> {
  const n = NETWORKS[network];
  const a = address.trim();
  if (n.family === "mainsail") return (await backend.msChecksum([a]))[0] ?? null;
  return (await backend.validateAddress(a, n.pubKeyHash)) ? a : null;
}

/** What to tell the user about an address that is not valid here. */
export function invalidAddressText(network: NetworkId): string {
  const n = NETWORKS[network];
  return n.family === "mainsail"
    ? `Not a valid ${n.name} address (0x followed by 40 hex characters; mixed case must match its checksum)`
    : `Not a valid ${n.name} address (should start with "${n.addressPrefix}")`;
}

/** Same address? 0x addresses compare without case (EIP-55 case is only a checksum). */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.startsWith("0x") || b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;
}
