import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export interface HttpResponse {
  status: number;
  body: any;
  /** seconds from a Retry-After header (429 responses) */
  retryAfter?: number | null;
}

export interface MsSignedTx {
  hash: string;
  /** signed RLP, hex without 0x: what gets broadcast */
  serialized: string;
  from: string;
  to: string;
  nonce: string;
  gasPrice: string;
  gasLimit: string;
  value: string;
  data: string;
}

export const backend = {
  deriveWallet: (passphrase: string, network: number) =>
    invoke<{ address: string; publicKey: string }>("derive_wallet", { passphrase, network }),
  validateAddress: (address: string, network: number) => invoke<boolean>("validate_address", { address, network }),
  generateMnemonic: (words: 12 | 24) => invoke<string>("generate_mnemonic", { words }),
  buildTransaction: (request: Record<string, unknown>) =>
    invoke<{ tx: Record<string, any>; size: number }>("build_transaction", { request }),
  signMessage: (message: string, passphrase: string, expectedAddress: string, network: number) =>
    invoke<{ message: string; publicKey: string; signature: string }>("sign_message", {
      message,
      passphrase,
      expectedAddress,
      network,
    }),
  verifyMessage: (message: string, publicKey: string, signature: string) =>
    invoke<boolean>("verify_message", { message, publicKey, signature }),
  addressFromPublicKey: (publicKey: string, network: number) =>
    invoke<string>("address_from_public_key", { publicKey, network }),
  // ---------- Mainsail (EVM) ----------
  msDeriveWallet: (passphrase: string) => invoke<{ address: string; publicKey: string }>("ms_derive_wallet", { passphrase }),
  /** EIP-55 checksummed form of each address, or null where one is not a valid 0x address */
  msChecksum: (addresses: string[]) => invoke<(string | null)[]>("ms_checksum_addresses", { addresses }),
  msAddressFromPublicKey: (publicKey: string) => invoke<string>("ms_address_from_public_key", { publicKey }),
  msDescribeCall: (request: Record<string, unknown>) =>
    invoke<{ to: string; value: string; data: string }>("ms_describe_call", { request }),
  msBuildTransaction: (request: Record<string, unknown>) => invoke<MsSignedTx>("ms_build_transaction", { request }),
  msValidatorPublicKey: (passphrase: string) => invoke<string>("ms_validator_public_key", { passphrase }),
  msSignMessage: (message: string, passphrase: string, expectedAddress: string) =>
    invoke<{ message: string; publicKey: string; signature: string }>("ms_sign_message", { message, passphrase, expectedAddress }),
  msVerifyMessage: (message: string, signer: string, signature: string) =>
    invoke<boolean>("ms_verify_message", { message, signer, signature }),
  httpGet: (url: string) => invoke<HttpResponse>("http_get", { url }),
  httpPost: (url: string, body: unknown) => invoke<HttpResponse>("http_post", { url, body }),
  loadState: () => invoke<any>("load_state"),
  saveState: (state: unknown) => invoke<void>("save_state", { state }),
};

export async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch (e) {
    console.error(e);
  }
}

// ---------- screen shield ----------
// While a passphrase or mnemonic is readable on screen, the window is excluded from screenshots,
// screen recording and screen sharing (macOS: NSWindow sharingType none; Windows: display
// affinity "exclude from capture"; no effect on Linux). Reference-counted across components.
let shields = 0;
async function applyShield() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setContentProtected(shields > 0);
  } catch {
    // best effort: unsupported platform
  }
}
/** Hide the window from screen capture until the returned function is called. */
export function shieldScreen(): () => void {
  shields++;
  applyShield();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    shields--;
    applyShield();
  };
}

export async function copyText(text: string) {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text);
  }
}
