// Mainsail (ARK's EVM chain) API adapter. Speaks the Mainsail REST API and JSON-RPC, and maps
// what comes back onto the same shapes the Core v3 client (ark.ts) returns, so the screens work
// on both. Amounts are converted from wei (18 decimals) to the app's 8-decimal arktoshi.
import { backend } from "./backend";
import { ApiError, get, trimBase, type Paged } from "./ark";
import type { RetryMode } from "./retry";
import type { ApiTransaction, Delegate, WalletData } from "./types";

export const CONSENSUS = "0x535B3D7A252fa034Ed71F0C53ec0C6F784cB64E1";
export const MULTIPAYMENT = "0x00EFd0D4639191C49908A7BddbB9A11A994A8527";
export const USERNAMES = "0x2c1DE3b4Dbb4aDebEbB5dcECAe825bE2a9fc6eb6";

/** 1 arktoshi (1e-8) = 1e10 wei */
export const WEI_PER_ARKTOSHI = 10_000_000_000n;
/** Gas limit for validator operations: they verify BLS keys, so estimates (made without real keys) are unreliable. Used ~246k on testnet. */
export const VALIDATOR_GAS = 500_000;
/** Mainsail validator registration locks this much (ARK, 18 decimals in the contract). */
export const VALIDATOR_LOCK = 250n * 100_000_000n; // arktoshi

const SEL = {
  vote: "6dd7d8ea",
  unvote: "3174b689",
  pay: "084ce708",
  register: "226f2645",
  registerLegacy: "602a9eee",
  update: "8f062626",
  updateLegacy: "5a8eed73",
  resign: "b85f5da2",
  username: "36a94134",
  usernameResign: "ebed6dab",
};

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function weiToArktoshi(wei: string | number | bigint | undefined | null): string {
  try {
    return (BigInt(wei ?? 0) / WEI_PER_ARKTOSHI).toString();
  } catch {
    return "0";
  }
}

/** Fee in arktoshi for gas × price (wei), rounded up so balance checks are never optimistic. */
export function gasFee(gas: bigint | number, gasPrice: bigint): bigint {
  const wei = BigInt(gas) * gasPrice;
  return (wei + WEI_PER_ARKTOSHI - 1n) / WEI_PER_ARKTOSHI;
}

function mapWallet(address: string, data: any): WalletData {
  const a = data.attributes ?? {};
  const isValidator = "validatorPublicKey" in a || "validatorRank" in a || "validatorResigned" in a;
  return {
    address: data.address ?? address,
    publicKey: data.publicKey ?? null,
    balance: weiToArktoshi(data.balance),
    nonce: String(data.nonce ?? "0"),
    secondPublicKey: a.secondPublicKey ?? null,
    vote: a.vote ?? null,
    delegate: isValidator
      ? {
          username: a.username ?? "",
          rank: a.validatorRank,
          resigned: !!a.validatorResigned,
          voteBalance: weiToArktoshi(a.validatorVoteBalance),
          blsPublicKey: a.validatorPublicKey ?? "",
        }
      : null,
    username: a.username ?? null,
    coldWallet: !data.publicKey,
    loadedAt: Date.now(),
  };
}

function mapValidator(v: any): Delegate {
  const a = v.attributes ?? {};
  return {
    username: a.username || "",
    address: v.address,
    // votes on Mainsail name the validator's address, so it is the key the vote screens use
    publicKey: v.address,
    votes: weiToArktoshi(a.validatorVoteBalance),
    rank: a.validatorRank ?? 0,
    isResigned: !!a.validatorResigned,
    approval: typeof a.validatorApproval === "number" ? a.validatorApproval * 100 : undefined,
    producedBlocks: a.validatorProducedBlocks,
  };
}

// ---------- ABI decoding (just what the transaction list needs) ----------

const word = (d: string, i: number) => d.slice(8 + i * 64, 8 + (i + 1) * 64);
const wordAt = (d: string, byteOffset: number) => d.slice(8 + byteOffset * 2, 8 + byteOffset * 2 + 64);
const num = (w: string) => (w ? BigInt("0x" + w) : 0n);
const addr = (w: string) => "0x" + w.slice(24);

function decodeArray(d: string, offsetWord: number): string[] {
  const off = Number(num(word(d, offsetWord)));
  const len = Number(num(wordAt(d, off)));
  const out: string[] = [];
  for (let k = 0; k < len && k < 1000; k++) out.push(wordAt(d, off + 32 + k * 32));
  return out;
}

function decodeString(d: string): string {
  try {
    const off = Number(num(word(d, 0)));
    const len = Number(num(wordAt(d, off)));
    const hex = d.slice(8 + (off + 32) * 2, 8 + (off + 32 + len) * 2);
    return new TextDecoder("utf-8", { fatal: true }).decode(hexBytes(hex));
  } catch {
    return "";
  }
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A transfer's data read as a text memo, when it is printable UTF-8. */
function memoText(hex: string): string | undefined {
  if (!hex || hex.length % 2) return undefined;
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(hexBytes(hex));
    return /^[^\u0000-\u0008\u000e-\u001f\u007f]*$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Mainsail-only kinds, numbered inside a typeGroup of their own (see txinfo.ts). */
export const MS_GROUP = 100;
export const MS_TYPE = { validatorUpdate: 1, usernameRegistration: 2, usernameResignation: 3, contractCall: 4 };

function mapTx(t: any): ApiTransaction {
  const data = String(t.data ?? "").replace(/^0x/, "").toLowerCase();
  const to: string = t.to ?? "";
  const sel = data.slice(0, 8);
  const failed = t.receipt ? Number(t.receipt.status) === 0 : false;
  const gasUsed = t.receipt?.gasUsed ?? t.gas ?? 0;
  const ms = Number(t.timestamp ?? 0);
  const tx: ApiTransaction = {
    id: t.hash,
    blockId: t.blockHash,
    version: 0,
    type: 0,
    typeGroup: 1,
    amount: failed ? "0" : weiToArktoshi(t.value),
    fee: gasFee(BigInt(gasUsed), BigInt(t.gasPrice ?? 0)).toString(),
    sender: t.from,
    senderPublicKey: t.senderPublicKey,
    recipient: to,
    nonce: String(t.nonce ?? ""),
    confirmations: t.confirmations,
    timestamp: { epoch: 0, unix: Math.floor(ms / 1000), human: new Date(ms).toISOString() },
    failed,
    evm: true,
  };
  const set = (typeGroup: number, type: number, asset?: any) => Object.assign(tx, { typeGroup, type, asset });
  if (sameAddress(to, CONSENSUS)) {
    if (sel === SEL.vote) set(1, 3, { votes: ["+" + addr(word(data, 0))] });
    else if (sel === SEL.unvote) set(1, 3, { votes: ["-"] });
    else if (sel === SEL.register || sel === SEL.registerLegacy) set(1, 2);
    else if (sel === SEL.update || sel === SEL.updateLegacy) set(MS_GROUP, MS_TYPE.validatorUpdate);
    else if (sel === SEL.resign) set(1, 7);
    else set(MS_GROUP, MS_TYPE.contractCall);
  } else if (sameAddress(to, MULTIPAYMENT) && sel === SEL.pay) {
    const recipients = decodeArray(data, 0).map(addr);
    const amounts = decodeArray(data, 1).map((w) => weiToArktoshi(num(w)));
    set(1, 6, { payments: recipients.map((r, i) => ({ recipientId: r, amount: amounts[i] ?? "0" })) });
    if (failed) tx.asset.payments = [];
  } else if (sameAddress(to, USERNAMES)) {
    if (sel === SEL.username) set(MS_GROUP, MS_TYPE.usernameRegistration, { username: decodeString(data) });
    else if (sel === SEL.usernameResign) set(MS_GROUP, MS_TYPE.usernameResignation);
    else set(MS_GROUP, MS_TYPE.contractCall);
  } else if (data) {
    const memo = memoText(data);
    if (memo !== undefined) tx.vendorField = memo;
    else set(MS_GROUP, MS_TYPE.contractCall);
  }
  return tx;
}

/** Decoded multipayment recipients come out lower case: give them their EIP-55 form, like the API's own addresses. */
async function checksumPayments(txs: ApiTransaction[]): Promise<ApiTransaction[]> {
  const all = txs.flatMap((t) => (t.asset?.payments ?? []).map((p: any) => p.recipientId as string));
  const votes = txs.flatMap((t) => (t.asset?.votes ?? []).filter((v: string) => v.length > 1).map((v: string) => v.slice(1)));
  if (!all.length && !votes.length) return txs;
  try {
    const fixed = await backend.msChecksum([...all, ...votes]);
    const map = new Map<string, string>();
    [...all, ...votes].forEach((a, i) => fixed[i] && map.set(a, fixed[i]!));
    for (const t of txs) {
      for (const p of t.asset?.payments ?? []) p.recipientId = map.get(p.recipientId) ?? p.recipientId;
      if (t.asset?.votes) t.asset.votes = t.asset.votes.map((v: string) => (v.length > 1 ? v[0] + (map.get(v.slice(1)) ?? v.slice(1)) : v));
    }
  } catch {
    // names still match (addresses are compared without case); only the display is lower case
  }
  return txs;
}

// ---------- validator directory (102 on testnet: read whole, searched here) ----------

const DIRECTORY_TTL_MS = 10 * 60_000;
const directories = new Map<string, { at: number; value: Promise<Delegate[]> }>();

function validatorDirectory(base: string): Promise<Delegate[]> {
  const hit = directories.get(base);
  if (hit && Date.now() - hit.at < DIRECTORY_TTL_MS) return hit.value;
  const value = (async () => {
    const page = (n: number) => get(base, `/validators?limit=100&page=${n}`);
    const first = await page(1);
    const pageCount: number = first.meta?.pageCount ?? 1;
    const bodies = [first];
    for (let n = 2; n <= Math.min(pageCount, 20); n++) bodies.push(await page(n));
    return bodies.flatMap((b) => (b.data as any[]).map(mapValidator)).sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
  })();
  directories.set(base, { at: Date.now(), value });
  value.catch(() => {
    if (directories.get(base)?.value === value) directories.delete(base);
  });
  return value;
}

// ---------- JSON-RPC ----------

export class RpcError extends Error {
  constructor(message: string, public data?: string) {
    super(message);
  }
}

let rpcId = 0;
async function rpc(rpcBase: string, method: string, params: unknown[]): Promise<any> {
  const res = await backend.httpPost(trimBase(rpcBase), { jsonrpc: "2.0", id: ++rpcId, method, params });
  const body = res.body ?? {};
  if (body.error) throw new RpcError(String(body.error.message ?? "RPC error"), body.error.data);
  if (res.status < 200 || res.status >= 300) throw new RpcError(`RPC error ${res.status}`);
  return body.result;
}

export interface CallInfo {
  from?: string;
  to: string;
  /** wei, 0x hex */
  value: string;
  /** 0x hex */
  data: string;
}

const legacyAbi = new Map<string, Promise<boolean>>();

export const ms = {
  async wallet(base: string, address: string, mode: RetryMode = "interactive"): Promise<WalletData> {
    try {
      const { data } = await get(base, `/wallets/${address}`, mode);
      return mapWallet(address, data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // never used on chain
        return { address, publicKey: null, balance: "0", nonce: "0", secondPublicKey: null, vote: null, delegate: null, username: null, coldWallet: true, loadedAt: Date.now() };
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
    _knownTotal = 0,
  ): Promise<Paged<ApiTransaction>> {
    const suffix = filter === "all" ? "" : `/${filter}`;
    const body = await get(base, `/wallets/${address}/transactions${suffix}?page=${page}&limit=${limit}&orderBy=timestamp:desc`);
    const data = await checksumPayments((body.data as any[]).map(mapTx));
    return { data, totalCount: body.meta?.totalCount ?? data.length, pageCount: body.meta?.pageCount ?? 1 };
  },

  async delegates(base: string, page: number, search = "", limit = 51): Promise<Paged<Delegate>> {
    const all = await validatorDirectory(base);
    const q = search.trim().toLowerCase();
    const hits = q ? all.filter((d) => d.username.toLowerCase().includes(q) || d.address.toLowerCase().includes(q)) : all;
    const pageCount = Math.max(1, Math.ceil(hits.length / limit));
    return { data: hits.slice((page - 1) * limit, page * limit), totalCount: hits.length, pageCount };
  },

  /** A validator by address (the key votes use on Mainsail). Falls back to the plain wallet for one outside the set. */
  async delegate(base: string, address: string): Promise<Delegate> {
    const dir = await validatorDirectory(base).catch(() => [] as Delegate[]);
    const hit = dir.find((d) => sameAddress(d.address, address));
    if (hit) return hit;
    try {
      const { data } = await get(base, `/validators/${address}`);
      return mapValidator(data);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      const { data } = await get(base, `/wallets/${address}`);
      return mapValidator(data);
    }
  },

  async addressName(base: string, address: string): Promise<string | null> {
    const dir = await validatorDirectory(base).catch(() => [] as Delegate[]);
    return dir.find((d) => sameAddress(d.address, address))?.username || null;
  },

  /** Gas prices in wei: the network's minimum and recent average, plus its gas limits. */
  async gas(base: string): Promise<{ minPrice: bigint; avgPrice: bigint; maxLimit: number; minLimit: number; validatorLock: bigint }> {
    const [cfg, fees] = await Promise.all([get(base, "/node/configuration"), get(base, "/node/fees").catch(() => null)]);
    const g = cfg.data?.constants?.gas ?? {};
    const minPrice = BigInt(g.minimumGasPrice ?? 5_000_000_000);
    let avgPrice = BigInt(fees?.data?.evmCall?.avg ?? minPrice);
    if (avgPrice < minPrice) avgPrice = minPrice;
    const lock = cfg.data?.constants?.validatorRegistrationFee;
    return {
      minPrice,
      avgPrice,
      maxLimit: g.maximumGasLimit ?? 5_000_000,
      minLimit: g.minimumGasLimit ?? 21_000,
      validatorLock: lock ? BigInt(weiToArktoshi(lock)) : VALIDATOR_LOCK,
    };
  },

  async tipHeight(base: string): Promise<number> {
    const body = await get(base, "/blockchain", "background");
    return body.data.block.number as number;
  },

  async blocksInRange(base: string, from: number, to: number): Promise<{ id: string; height: number; transactions: number }[]> {
    const body = await get(base, `/blocks?number.from=${from}&number.to=${to}&limit=100`, "background");
    return (body.data as any[])
      .map((b) => ({ id: b.hash, height: b.number, transactions: b.transactionsCount ?? 0 }))
      .sort((a, b) => a.height - b.height);
  },

  async blockTransactions(base: string, blockId: string): Promise<ApiTransaction[]> {
    const out: ApiTransaction[] = [];
    for (let page = 1; page <= 10; page++) {
      const body = await get(base, `/blocks/${blockId}/transactions?limit=100&page=${page}`, "background");
      out.push(...(body.data as any[]).map(mapTx));
      if (!body.meta?.next) break;
    }
    return checksumPayments(out);
  },

  /** Check a custom API URL. */
  async probe(base: string): Promise<{ pubKeyHash: number; nethash: string; height: number; version?: string; symbol?: string }> {
    const [cfg, chain] = await Promise.all([get(base, "/node/configuration"), get(base, "/blockchain")]);
    return {
      pubKeyHash: 0,
      nethash: cfg.data.nethash,
      height: chain.data.block.number,
      version: cfg.data.core?.version,
      symbol: cfg.data.symbol,
    };
  },

  /** Post a signed transaction (RLP hex) to the transaction API. */
  async broadcast(txBase: string, serialized: string): Promise<{ accepted: boolean; message: string }> {
    const res = await backend.httpPost(trimBase(txBase) + "/transactions", { transactions: [serialized] });
    const body = res.body ?? {};
    const accepted: unknown[] = body?.data?.accept ?? [];
    if (res.status >= 200 && res.status < 300 && accepted.length > 0) {
      return { accepted: true, message: "Transaction accepted by the network" };
    }
    const errs = body?.errors ?? {};
    const first: any = Object.values(errs)[0];
    const msg = (first && (Array.isArray(first) ? first.map((e: any) => e.message).join("; ") : first.message)) || body?.message || `Node responded with status ${res.status}`;
    return { accepted: false, message: msg };
  },

  async chainId(rpcBase: string): Promise<number> {
    return Number(await rpc(rpcBase, "eth_chainId", []));
  },

  async estimateGas(rpcBase: string, call: CallInfo): Promise<number> {
    return Number(await rpc(rpcBase, "eth_estimateGas", [call]));
  },

  /**
   * Whether the network's consensus contract still has the older one-argument registerValidator(bytes)
   * (testnet in Nov 2026) rather than registerValidator(bytes,bytes) with a proof of possession. Asked
   * by calling the new form with nothing attached: the new contract rejects it with an error code
   * (InvalidFee / InvalidProofOfPossession), the old one reverts without data (no such function).
   */
  legacyValidatorAbi(rpcBase: string): Promise<boolean> {
    let p = legacyAbi.get(rpcBase);
    if (!p) {
      const pk = "11".repeat(48);
      const pop = "22".repeat(96);
      const w = (n: number) => n.toString(16).padStart(64, "0");
      const data = "0x" + SEL.register + w(64) + w(160) + w(48) + pk + "0".repeat(32) + w(96) + pop;
      p = rpc(rpcBase, "eth_call", [{ to: CONSENSUS, data }, "latest"]).then(
        () => false,
        (e) => {
          if (!(e instanceof RpcError) || e.data === undefined) throw e; // network trouble: ask again next time
          return e.data === "0x" || e.data === "";
        },
      );
      p.catch(() => legacyAbi.delete(rpcBase));
      legacyAbi.set(rpcBase, p);
    }
    return p;
  },
};
