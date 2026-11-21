import { backend } from "./backend";
import { withRetry } from "./retry";
import type { ApiTransaction, Delegate, WalletData } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export interface Paged<T> {
  data: T[];
  totalCount: number;
  pageCount: number;
}

export interface NodeFeeConfig {
  dynamicEnabled: boolean;
  minFeePool: number;
  minFeeBroadcast: number;
  addonBytes: Record<string, number>;
  staticFees: Record<string, string>;
  /** 7-day stats from /node/fees: type name -> {min, avg, max} in arktoshi */
  stats: Record<string, { min: string; avg: string; max: string }>;
  explorer?: string;
  activeDelegates: number;
  pubKeyHash?: number;
}

function trimBase(base: string) {
  return base.replace(/\/+$/, "");
}

function get(base: string, path: string): Promise<any> {
  return withRetry(() => getOnce(base, path));
}

async function getOnce(base: string, path: string): Promise<any> {
  let res;
  try {
    res = await backend.httpGet(trimBase(base) + path);
  } catch (e: any) {
    throw new ApiError(String(e?.message ?? e)); // network error: no status, retried
  }
  if (res.status === 404) throw new ApiError("Not found", 404);
  if (res.status < 200 || res.status >= 300) {
    const msg = typeof res.body === "object" ? res.body?.message || res.body?.error : String(res.body).slice(0, 120);
    throw new ApiError(`API error ${res.status}${msg ? ": " + msg : ""}`, res.status);
  }
  return res.body;
}

function mapDelegate(d: any): Delegate {
  return {
    username: d.username,
    address: d.address,
    publicKey: d.publicKey,
    votes: String(d.votes ?? "0"),
    rank: d.rank ?? 0,
    isResigned: !!d.isResigned,
    approval: d.production?.approval,
    producedBlocks: d.blocks?.produced,
  };
}

const feeCache = new Map<string, { at: number; value: NodeFeeConfig }>();
const delegateCache = new Map<string, Delegate>();

export const ark = {
  async wallet(base: string, address: string): Promise<WalletData> {
    try {
      const { data } = await get(base, `/wallets/${address}`);
      const a = data.attributes ?? {};
      return {
        address,
        publicKey: data.publicKey ?? null,
        balance: String(data.balance ?? "0"),
        nonce: String(data.nonce ?? "0"),
        secondPublicKey: a.secondPublicKey ?? null,
        vote: a.vote ?? null,
        delegate: a.delegate
          ? {
              username: a.delegate.username,
              rank: a.delegate.rank,
              resigned: !!a.delegate.resigned,
              voteBalance: a.delegate.voteBalance,
            }
          : null,
        coldWallet: !data.publicKey,
        loadedAt: Date.now(),
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Never seen on chain: empty cold wallet
        return {
          address,
          publicKey: null,
          balance: "0",
          nonce: "0",
          secondPublicKey: null,
          vote: null,
          delegate: null,
          coldWallet: true,
          loadedAt: Date.now(),
        };
      }
      throw e;
    }
  },

  async transactions(
    base: string,
    address: string,
    page: number,
    filter: "all" | "sent" | "received",
    limit = 25,
  ): Promise<Paged<ApiTransaction>> {
    const suffix = filter === "all" ? "" : `/${filter}`;
    const body = await get(
      base,
      `/wallets/${address}/transactions${suffix}?page=${page}&limit=${limit}&orderBy=timestamp:desc`,
    );
    return { data: body.data, totalCount: body.meta?.totalCount ?? 0, pageCount: body.meta?.pageCount ?? 1 };
  },

  async delegates(base: string, page: number, search = "", limit = 51): Promise<Paged<Delegate>> {
    const q = search.trim() ? `&username=${encodeURIComponent(`%${search.trim().toLowerCase()}%`)}` : "";
    const body = await get(base, `/delegates?page=${page}&limit=${limit}&orderBy=rank:asc${q}`);
    const data = (body.data as any[]).map(mapDelegate);
    data.forEach((d) => delegateCache.set(base + d.publicKey, d));
    return { data, totalCount: body.meta?.totalCount ?? data.length, pageCount: body.meta?.pageCount ?? 1 };
  },

  async delegate(base: string, publicKey: string): Promise<Delegate> {
    const key = base + publicKey;
    const cached = delegateCache.get(key);
    if (cached) return cached;
    const { data } = await get(base, `/delegates/${publicKey}`);
    const d = mapDelegate(data);
    delegateCache.set(key, d);
    return d;
  },

  async fees(base: string, force = false): Promise<NodeFeeConfig> {
    const hit = feeCache.get(base);
    if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
    const [cfg, fees] = await Promise.all([get(base, "/node/configuration"), get(base, "/node/fees?days=7")]);
    const c = cfg.data;
    const dyn = c.transactionPool?.dynamicFees ?? {};
    const stats: NodeFeeConfig["stats"] = {};
    const g1 = fees?.data?.["1"] ?? {};
    for (const [k, v] of Object.entries<any>(g1)) stats[k] = { min: v.min, avg: v.avg, max: v.max };
    const staticFees: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(c.constants?.fees?.staticFees ?? {})) staticFees[k] = String(v);
    const value: NodeFeeConfig = {
      dynamicEnabled: !!dyn.enabled,
      minFeePool: Number(dyn.minFeePool ?? 0),
      minFeeBroadcast: Number(dyn.minFeeBroadcast ?? 0),
      addonBytes: dyn.addonBytes ?? {},
      staticFees,
      stats,
      explorer: c.explorer,
      activeDelegates: c.constants?.activeDelegates ?? 51,
    };
    feeCache.set(base, { at: Date.now(), value });
    return value;
  },

  /** Newest blocks, highest first: [{ id, height, transactions }] */
  async latestBlocks(base: string, limit = 20): Promise<{ id: string; height: number; transactions: number }[]> {
    const body = await get(base, `/blocks?limit=${limit}&orderBy=height:desc`);
    return (body.data as any[]).map((b) => ({ id: b.id, height: b.height, transactions: b.transactions ?? 0 }));
  },

  /** All transactions in a block (a block holds at most 150). */
  async blockTransactions(base: string, blockId: string): Promise<ApiTransaction[]> {
    const out: ApiTransaction[] = [];
    for (let page = 1; page <= 3; page++) {
      const body = await get(base, `/blocks/${blockId}/transactions?limit=100&page=${page}`);
      out.push(...body.data);
      if (!body.meta?.next) break;
    }
    return out;
  },

  /** Check a custom API URL: returns nethash + pubKeyHash + height. */
  async probe(base: string): Promise<{ pubKeyHash: number; nethash: string; height: number; version?: string }> {
    const [crypto, chain, cfg] = await Promise.all([
      get(base, "/node/configuration/crypto"),
      get(base, "/blockchain"),
      get(base, "/node/configuration").catch(() => null),
    ]);
    return {
      pubKeyHash: crypto.data.network.pubKeyHash,
      nethash: crypto.data.network.nethash,
      height: chain.data.block.height,
      version: cfg?.data?.core?.version,
    };
  },

  async broadcast(base: string, tx: Record<string, any>): Promise<{ accepted: boolean; message: string }> {
    const res = await backend.httpPost(trimBase(base) + "/transactions", { transactions: [tx] });
    const body = res.body ?? {};
    const id = tx.id as string;
    const accepted: string[] = body?.data?.accept ?? [];
    if (res.status >= 200 && res.status < 300 && accepted.includes(id)) {
      return { accepted: true, message: "Transaction accepted by the network" };
    }
    const err = body?.errors?.[id];
    const msg =
      (err && (Array.isArray(err) ? err.map((e: any) => e.message).join("; ") : err.message)) ||
      body?.message ||
      `Node responded with status ${res.status}`;
    return { accepted: false, message: msg };
  },
};
