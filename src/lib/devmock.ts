// Dev-only: lets the UI run in a plain browser (vite dev server) without the Tauri backend.
// Network calls go through fetch; crypto commands return placeholders. Never bundled in production builds.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const KEY = "ark-wallet-dev-state";

export function installDevMock() {
  mockWindows("main");
  mockIPC(async (cmd, args: any) => {
    switch (cmd) {
      case "http_get": {
        const r = await fetch(args.url);
        const text = await r.text();
        let body: any = text;
        try {
          body = JSON.parse(text);
        } catch {}
        const ra = parseFloat(r.headers.get("retry-after") ?? "");
        return { status: r.status, body, retryAfter: Number.isFinite(ra) ? ra : null };
      }
      case "http_post":
        throw new Error("Broadcasting is disabled in browser preview");
      case "load_state": {
        const s = localStorage.getItem(KEY);
        return s ? JSON.parse(s) : null;
      }
      case "save_state":
        localStorage.setItem(KEY, JSON.stringify(args.state));
        return null;
      case "validate_address":
        return /^[AD][1-9A-HJ-NP-Za-km-z]{33}$/.test(args.address.trim()) &&
          args.address.trim()[0] === (args.network === 23 ? "A" : "D");
      case "generate_mnemonic":
        return Array.from({ length: args.words }, (_, i) => ["abandon", "ability", "able", "about"][i % 4]).join(" ");
      case "derive_wallet":
        return { address: "AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj", publicKey: "02" + "0".repeat(64) };
      case "plugin:opener|open_url":
        window.open(args.url, "_blank");
        return null;
      case "plugin:clipboard-manager|write_text":
        await navigator.clipboard?.writeText(args.text);
        return null;
      default:
        throw new Error(`${cmd} is not available in browser preview`);
    }
  });
}
