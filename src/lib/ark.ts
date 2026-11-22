import { backend } from "./backend";
import { noteRateLimit, RateLimitError, respectCooldown, withRetry, type RetryMode } from "./retry";
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

function get(base: string, path: string, mode: RetryMode = "interactive"): Promise<any> {
  return withRetry(() => getOnce(base, path, mode), mode);
}

async function getOnce(base: string, path: string, mode: RetryMode): Promise<any> {
  const url = trimBase(base) + path;
  await respectCooldown(url, mode);
  let res;
  try {
    res = await backend.httpGet(url);
  } catch (e: any) {
    throw new ApiError(String(e?.message ?? e)); // network error: no status, retried
  }
  if (res.status === 429) {
    noteRateLimit(url, res.retryAfter);
    throw new RateLimitError(res.retryAfter ?? 30);
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

/** Pages deeper than this many rows are read oldest-first when the total is known (see transactions()). */
const DEEP_OFFSET = 20_000;

const feeCache = new Map<string, { at: number; value: NodeFeeConfig }>();
/** address -> registered delegate username (or null), per API base; holds the in-flight promise to dedupe */
const nameCache = new Map<string, Promise<string | null>>();
const delegateCache = new Map<string, Delegate>();

/**
 * Every registered delegate (incl. resigned), by address, per API base. Transaction lists name
 * counterparties by delegate username; looking each address up separately cost one request per
 * row (up to 100 a page), which alone could exhaust the 200 requests/min limit after a few page
 * clicks. The whole directory is ~14 requests of 100, fetched once and refreshed every 30 min.
 */
const DIRECTORY_TTL_MS = 30 * 60_000;
const directories = new Map<string, { at: number; value: Promise<Map<string, Delegate>> }>();

function delegateDirectory(base: string): Promise<Map<string, Delegate>> {
  const hit = directories.get(base);
  if (hit && Date.now() - hit.at < DIRECTORY_TTL_MS) return hit.value;
  const value = (async () => {
    // username order is stable while paging (rank order can shift under us when votes change)
    const page = (n: number) => get(base, `/delegates?limit=100&page=${n}&orderBy=username:asc`);
    const first = await page(1);
    const pageCount: number = first.meta?.pageCount ?? 1;
    const bodies = [first];
    for (let n = 2; n <= pageCount; n += 4) {
      // a few at a time, so a page the user is waiting on is never stuck behind all of them
      const batch = [];
      for (let k = n; k < Math.min(n + 4, pageCount + 1); k++) batch.push(page(k));
      bodies.push(...(await Promise.all(batch)));
    }
    const map = new Map<string, Delegate>();
    for (const b of bodies)
      for (const raw of b.data as any[]) {
        const d = mapDelegate(raw);
        map.set(d.address, d);
        delegateCache.set(base + d.publicKey, d);
      }
    return map;
  })();
  directories.set(base, { at: Date.now(), value });
  value.catch(() => {
    if (directories.get(base)?.value === value) directories.delete(base);
  });
  return value;
}

export const ark = {
  async wallet(base: string, address: string, mode: RetryMode = "interactive"): Promise<WalletData> {
    try {
      const { data } = await get(base, `/wallets/${address}`, mode);
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

  /**
   * One page of a wallet's transactions, newest first.
   *
   * Deep pages are expensive for the API, and much more so newest-first: on api.ark.io a
   * newest-first query more than ~20k rows deep usually runs into the server's ~3.2s query
   * timeout (HTTP 500), while the same rows read oldest-first come back in 1-2.5s at any depth.
   * So once the total is known, deep pages are read oldest-first (reversed, so the result is
   * identical) and newest-first is only the fallback.
   */
  async transactions(
    base: string,
    address: string,
    page: number,
    filter: "all" | "sent" | "received",
    limit = 25,
    knownTotal = 0,
  ): Promise<Paged<ApiTransaction>> {
    const suffix = filter === "all" ? "" : `/${filter}`;
    const path = (p: number, dir: "asc" | "desc") =>
      `/wallets/${address}/transactions${suffix}?page=${p}&limit=${limit}&orderBy=timestamp:${dir}`;
    const offset = (page - 1) * limit;
    const newestFirst = async (mode: RetryMode = "interactive") => {
      const body = await get(base, path(page, "desc"), mode);
      return {
        data: body.data as ApiTransaction[],
        totalCount: body.meta?.totalCount ?? 0,
        pageCount: body.meta?.pageCount ?? 1,
      };
    };
    if (offset < DEEP_OFFSET || !knownTotal || offset >= knownTotal) return newestFirst();

    // same rows, read oldest-first: rows [start, start + take) in ascending order, reversed
    const oldestFirst = async (n: number, again = true): Promise<Paged<ApiTransaction>> => {
      const take = Math.min(limit, n - offset);
      const start = n - offset - take;
      const first = Math.floor(start / limit) + 1;
      const pages = (start % limit) + take > limit ? [first, first + 1] : [first];
      const bodies = await Promise.all(pages.map((p) => get(base, path(p, "asc"))));
      const total: number = bodies[0].meta?.totalCount ?? n;
      // new transactions arrived since the total was counted: the window moved, read it again
      if (total !== n && again && offset < total) return oldestFirst(total, false);
      const rows = bodies.flatMap((b) => b.data as ApiTransaction[]);
      return {
        data: rows.slice(start % limit, (start % limit) + take).reverse(),
        totalCount: total,
        pageCount: Math.max(1, Math.ceil(total / limit)),
      };
    };
    try {
      return await oldestFirst(knownTotal);
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== undefined && e.status < 500)) throw e;
      return newestFirst("background");
    }
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
    if (/^0[23][0-9a-f]{64}$/i.test(publicKey) && directories.has(base)) {
      // the directory is loaded or on its way: wait for it rather than spend a request
      const found = await delegateDirectory(base).then(() => delegateCache.get(key), () => undefined);
      if (found) return found;
    }
    const { data } = await get(base, `/delegates/${publicKey}`);
    const d = mapDelegate(data);
    delegateCache.set(key, d);
    return d;
  },

  /** Known on-chain name for an address: its registered delegate username, if any. Cached. */
  addressName(base: string, address: string): Promise<string | null> {
    const key = base + address;
    let p = nameCache.get(key);
    if (!p) {
      p = delegateDirectory(base).then(
        (dir) => dir.get(address)?.username ?? null,
        // directory unavailable (rate limit / outage): leave the address unnamed for now
        () => {
          nameCache.delete(key);
          return null;
        },
      );
      nameCache.set(key, p);
    }
    return p;
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

  /**
   * Current chain height. /blockchain answers in ~0.15s; /blocks?orderBy=height:desc takes
   * 2.5-3.5s and fails about half the time, so the watcher polls this instead.
   */
  async tipHeight(base: string): Promise<number> {
    const body = await get(base, "/blockchain", "background");
    return body.data.block.height as number;
  },

  /** Blocks in a height range (inclusive), lowest first. Fast (~0.15s) thanks to the height filter. */
  async blocksInRange(base: string, from: number, to: number): Promise<{ id: string; height: number; transactions: number }[]> {
    const body = await get(base, `/blocks?height.from=${from}&height.to=${to}&limit=100`, "background");
    return (body.data as any[])
      .map((b) => ({ id: b.id, height: b.height, transactions: b.transactions ?? 0 }))
      .sort((a, b) => a.height - b.height);
  },

  /** All transactions in a block (a block holds at most 150). */
  async blockTransactions(base: string, blockId: string): Promise<ApiTransaction[]> {
    const out: ApiTransaction[] = [];
    for (let page = 1; page <= 3; page++) {
      const body = await get(base, `/blocks/${blockId}/transactions?limit=100&page=${page}`, "background");
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
