import { backend } from "./backend";
import { ark } from "./ark";
import { fetchHistory, fetchPrice, type PriceInfo } from "./price";
import {
  DEFAULT_SETTINGS,
  NETWORKS,
  type FeeChoice,
  type NetworkId,
  type PersistedState,
  type Settings,
  type WalletData,
  type WalletEntry,
} from "./types";

export type View = { name: "dashboard" } | { name: "wallet"; id: string } | { name: "settings" };

interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
  link?: { label: string; url: string };
}

class AppState {
  loaded = $state(false);
  wallets = $state<WalletEntry[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  view = $state<View>({ name: "dashboard" });

  data = $state<Record<string, WalletData>>({});
  errors = $state<Record<string, string>>({});
  loading = $state<Record<string, boolean>>({});
  /** highest nonce we broadcast per address but the API may not reflect yet */
  pendingNonce = $state<Record<string, bigint>>({});

  price = $state<PriceInfo | null>(null);
  priceError = $state<string | null>(null);
  history = $state<[number, number][]>([]);

  toasts = $state<Toast[]>([]);
  private toastSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  apiUrl(network: NetworkId): string {
    return (this.settings.apiUrls[network] || NETWORKS[network].defaultApi).replace(/\/+$/, "");
  }

  explorerTx(network: NetworkId, id: string) {
    return `${NETWORKS[network].explorer}/transactions/${id}`;
  }
  explorerAddress(network: NetworkId, address: string) {
    return `${NETWORKS[network].explorer}/addresses/${address}`;
  }

  wallet(id: string): WalletEntry | undefined {
    return this.wallets.find((w) => w.id === id);
  }

  async init() {
    try {
      const s = (await backend.loadState()) as PersistedState | null;
      if (s && s.wallets) {
        this.wallets = s.wallets;
        this.settings = { ...DEFAULT_SETTINGS, ...s.settings, apiUrls: { ...(s.settings?.apiUrls ?? {}) } };
      }
    } catch (e) {
      this.toast("error", `Could not load saved data: ${e}`);
    }
    this.loaded = true;
    this.refreshAll();
    this.refreshPrice();
    this.restartTimer();
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer);
    const secs = Math.max(15, this.settings.refreshSeconds || 60);
    let tick = 0;
    this.timer = setInterval(() => {
      tick++;
      this.refreshAll();
      if ((tick * secs) % 300 < secs) this.refreshPrice();
    }, secs * 1000);
  }

  async persist() {
    const state: PersistedState = {
      version: 1,
      wallets: $state.snapshot(this.wallets),
      settings: $state.snapshot(this.settings),
    };
    try {
      await backend.saveState(state);
    } catch (e) {
      this.toast("error", `Could not save: ${e}`);
    }
  }

  // ---------- wallets ----------

  addWallet(entry: Omit<WalletEntry, "id" | "addedAt" | "autoName">): WalletEntry | null {
    if (this.wallets.some((w) => w.address === entry.address)) {
      this.toast("info", "That wallet is already in your collection");
      return null;
    }
    const auto = !entry.name.trim();
    this.wallets.push({
      ...entry,
      name: auto ? `Wallet ${this.wallets.length + 1}` : entry.name.trim(),
      autoName: auto,
      id: crypto.randomUUID(),
      addedAt: Date.now(),
    });
    const w = this.wallets[this.wallets.length - 1]; // the reactive proxy
    this.persist();
    this.refreshWallet(w);
    return w;
  }

  renameWallet(id: string, name: string) {
    const w = this.wallet(id);
    if (!w) return;
    w.name = name.trim() || w.name;
    w.autoName = false;
    this.persist();
  }

  removeWallet(id: string) {
    this.wallets = this.wallets.filter((w) => w.id !== id);
    if (this.view.name === "wallet" && this.view.id === id) this.view = { name: "dashboard" };
    this.persist();
  }

  moveWallet(id: string, delta: number) {
    const i = this.wallets.findIndex((w) => w.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.wallets.length) return;
    const arr = [...this.wallets];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.wallets = arr;
    this.persist();
  }

  async refreshWallet(entry: WalletEntry) {
    const w = this.wallets.find((x) => x.id === entry.id) ?? entry; // always mutate the reactive copy
    this.loading[w.address] = true;
    try {
      const d = await ark.wallet(this.apiUrl(w.network), w.address);
      this.data[w.address] = d;
      delete this.errors[w.address];
      let changed = false;
      if (d.publicKey && !w.publicKey) {
        w.publicKey = d.publicKey;
        changed = true;
      }
      // Unnamed wallets (or ones still on a default "Wallet N" name) take their delegate username
      const auto = w.autoName ?? /^Wallet \d+$/.test(w.name);
      if (auto && d.delegate?.username && w.name !== d.delegate.username) {
        w.name = d.delegate.username;
        w.autoName = true;
        changed = true;
      }
      if (changed) this.persist();
      const pend = this.pendingNonce[w.address];
      if (pend !== undefined && BigInt(d.nonce) >= pend) delete this.pendingNonce[w.address];
    } catch (e: any) {
      this.errors[w.address] = e?.message ?? String(e);
    } finally {
      this.loading[w.address] = false;
    }
  }

  refreshAll() {
    for (const w of this.wallets) this.refreshWallet(w);
  }

  /** Nonce to use for the next transaction from this wallet. */
  nextNonce(address: string): string {
    const d = this.data[address];
    let n = BigInt(d?.nonce ?? "0");
    const p = this.pendingNonce[address];
    if (p !== undefined && p > n) n = p;
    return (n + 1n).toString();
  }

  markBroadcast(address: string, nonce: string) {
    this.pendingNonce[address] = BigInt(nonce);
    const w = this.wallets.find((x) => x.address === address);
    if (w) {
      setTimeout(() => this.refreshWallet(w), 9000);
      setTimeout(() => this.refreshWallet(w), 25000);
    }
  }

  // ---------- price ----------

  async refreshPrice() {
    const cur = this.settings.currency;
    try {
      this.price = await fetchPrice(cur);
      this.priceError = null;
    } catch (e: any) {
      this.priceError = e?.message ?? String(e);
    }
    try {
      this.history = await fetchHistory(cur, 7);
    } catch {
      /* chart is optional */
    }
  }

  fiatValue(network: NetworkId, arktoshi: string | bigint | undefined): number | null {
    if (!NETWORKS[network].hasFiatValue || !this.price || arktoshi === undefined) return null;
    return (Number(BigInt(arktoshi)) / 1e8) * this.price.price;
  }

  // ---------- settings ----------

  setFeeChoice(c: FeeChoice) {
    if (this.settings.feeChoice !== c) {
      this.settings.feeChoice = c;
      this.persist();
    }
  }

  setCurrency(c: string) {
    this.settings.currency = c;
    this.persist();
    this.refreshPrice();
  }

  setApiUrl(network: NetworkId, url: string | null) {
    if (url && url.replace(/\/+$/, "") !== NETWORKS[network].defaultApi) this.settings.apiUrls[network] = url.trim();
    else delete this.settings.apiUrls[network];
    this.persist();
    this.data = {};
    this.refreshAll();
  }

  // ---------- toasts ----------

  toast(kind: Toast["kind"], text: string, link?: Toast["link"], ms = 6000) {
    const id = ++this.toastSeq;
    this.toasts.push({ id, kind, text, link });
    setTimeout(() => this.dismiss(id), ms);
  }
  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppState();
