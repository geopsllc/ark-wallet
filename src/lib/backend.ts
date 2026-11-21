import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export interface HttpResponse {
  status: number;
  body: any;
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

export async function copyText(text: string) {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text);
  }
}
