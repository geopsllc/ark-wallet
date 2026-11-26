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
      case "exchange_post": {
        // the local Exchange Worker (its own repo, `npm run dev`) allows the dev preview's origin (DEV_ORIGIN)
        const r = await fetch("http://127.0.0.1:8787" + args.path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.body),
        });
        const ra = parseFloat(r.headers.get("retry-after") ?? "");
        return { status: r.status, body: await r.json().catch(() => null), retryAfter: Number.isFinite(ra) ? ra : null };
      }
      case "evm_address_check": {
        // no keccak in the preview: format only (the app checks the EIP-55 checksum in Rust)
        const a = String(args.address).trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return "invalid";
        return /[a-f]/.test(a.slice(2)) && /[A-F]/.test(a.slice(2)) ? "ok" : "unchecked";
      }
      case "http_post": {
        // read-only JSON-RPC (gas estimates, contract reads) works; broadcasting does not
        if (!/\/rpc\b/.test(args.url) || ["eth_sendRawTransaction"].includes(args.body?.method))
          throw new Error("Broadcasting is disabled in browser preview");
        const r = await fetch(args.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args.body) });
        return { status: r.status, body: await r.json().catch(() => null), retryAfter: null };
      }
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
      // Mainsail: no keccak / secp256k1 in the preview, so placeholders (the app does these in Rust)
      case "ms_checksum_addresses":
        return (args.addresses as string[]).map((x) => (/^0x[0-9a-fA-F]{40}$/.test(x.trim()) ? x.trim() : null));
      case "ms_derive_wallet":
        return { address: "0x91D0eAEe8958e97F98Bc76D9A14004d90130a8c4", publicKey: "02" + "0".repeat(64) };
      case "ms_validator_public_key":
        return "a1" + "0".repeat(94);
      case "ms_describe_call":
        return { to: args.request.recipientId ?? "0x535B3D7A252fa034Ed71F0C53ec0C6F784cB64E1", value: "0", data: "0x" };
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
