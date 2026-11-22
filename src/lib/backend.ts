import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export interface HttpResponse {
  status: number;
  body: any;
  /** seconds from a Retry-After header (429 responses) */
  retryAfter?: number | null;
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
