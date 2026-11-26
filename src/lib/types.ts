export type NetworkId = "mainnet" | "testnet";

/** "core": ARK Core v3 (base58 addresses, Schnorr, arktoshi fees). "mainsail": ARK's EVM chain (0x addresses, gas). */
export type ChainFamily = "core" | "mainsail";

export interface NetworkDef {
  id: NetworkId;
  family: ChainFamily;
  name: string;
  /** Short label for badges in lists */
  badge: string;
  /** Core only: address version byte */
  pubKeyHash: number;
  /** Mainsail only: EIP-155 chain id */
  chainId?: number;
  token: string;
  symbol: string;
  defaultApi: string;
  /** Mainsail only: where signed transactions are posted (POST {txApi}/transactions) */
  defaultTxApi?: string;
  /** Mainsail only: JSON-RPC endpoint (gas estimates, contract reads) */
  defaultRpc?: string;
  /** Test networks only: where free test coins come from */
  faucet?: string;
  explorer: string;
  addressPrefix: string;
  hasFiatValue: boolean;
  /** What block producers are called on this chain */
  producer: "delegate" | "validator";
  /** Size of the active forging / validating set */
  activeProducers: number;
}

export const NETWORKS: Record<NetworkId, NetworkDef> = {
  mainnet: {
    id: "mainnet",
    family: "core",
    name: "Mainnet",
    badge: "Mainnet",
    pubKeyHash: 23,
    token: "ARK",
    symbol: "Ѧ",
    defaultApi: "https://api.ark.io/api",
    explorer: "https://ark.geops.net",
    addressPrefix: "A",
    hasFiatValue: true,
    producer: "delegate",
    activeProducers: 51,
  },
  testnet: {
    id: "testnet",
    family: "mainsail",
    name: "Mainsail Testnet",
    badge: "Testnet",
    pubKeyHash: 0,
    chainId: 11812,
    token: "TARK",
    symbol: "TѦ",
    defaultApi: "https://testnet.mainsailhq.com/api",
    defaultTxApi: "https://testnet.mainsailhq.com/tx/api",
    defaultRpc: "https://testnet.mainsailhq.com/rpc/api",
    faucet: "https://faucet-demo.mainsailhq.com/",
    explorer: "https://explorer-demo.mainsailhq.com",
    addressPrefix: "0x",
    hasFiatValue: false,
    producer: "validator",
    activeProducers: 53,
  },
};

export const isMainsail = (n: NetworkId) => NETWORKS[n]?.family === "mainsail";

/** A wallet in the collection. Only public data is ever stored. */
export interface WalletEntry {
  id: string;
  name: string;
  address: string;
  network: NetworkId;
  publicKey?: string;
  addedAt: number;
  /** Name was not chosen by the user: replace it with the delegate username when there is one */
  autoName?: boolean;
  /** Identity color (assigned when added, least-used palette color) */
  color?: string;
}

export type FeeChoice = "min" | "avg";

export interface Settings {
  apiUrls: Partial<Record<NetworkId, string>>;
  /** Mainsail: custom transaction API and JSON-RPC endpoints (a node serves them on their own ports) */
  txApiUrls?: Partial<Record<NetworkId, string>>;
  rpcUrls?: Partial<Record<NetworkId, string>>;
  currency: string;
  feeChoice: FeeChoice;
  refreshSeconds: number;
  sidebarWidth?: number;
  /** Rows per page in transaction tables (25 / 50 / 100) */
  txPageSize?: number;
  /** Count delegate wallets in the portfolio total (off by default: their balance is shared out to voters) */
  includeDelegates?: boolean;
  /** Your named USDC/USDT payout addresses for the Exchange tab */
  payoutAddresses?: PayoutAddress[];
  /** id of the payout address used last */
  lastPayoutId?: string;
}

export interface PayoutAddress {
  id: string;
  name: string;
  /** coin received: "usdc" or "usdt" (older entries are USDC) */
  coin: string;
  /** network id (polygon, base, ethereum, …) */
  network: string;
  /** 0x address; every exchange order is checked against it */
  address: string;
}

/** One drain order, kept so its links stay reachable after the screen is closed. */
export interface DrainRecord {
  id: string;
  walletId: string;
  address: string;
  at: number;
  service: string;
  provider: string;
  orderId: string;
  providerOrderId: string;
  depositAddress: string;
  /** arktoshi */
  amount: string;
  amountTo: string;
  payoutAddress: string;
  networkTo: string;
  /** network id (polygon, base, …); older records are Polygon */
  chain?: string;
  /** "usdc" or "usdt"; older records are USDC */
  coin?: string;
  txId?: string;
  status: "created" | "sent";
}

export interface PersistedState {
  version: 1;
  wallets: WalletEntry[];
  settings: Settings;
  drains?: DrainRecord[];
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrls: {},
  currency: "usd",
  feeChoice: "avg",
  refreshSeconds: 60,
};

/** Live data for a wallet from the network. */
export interface WalletData {
  address: string;
  publicKey: string | null;
  balance: string;
  nonce: string;
  secondPublicKey: string | null;
  vote: string | null;
  /** Core: the delegate. Mainsail: the validator (blsPublicKey is its consensus key, "" when none is registered). */
  delegate: { username: string; rank?: number; resigned?: boolean; voteBalance?: string; blsPublicKey?: string } | null;
  /** Mainsail: registered username (independent of being a validator) */
  username?: string | null;
  coldWallet: boolean;
  loadedAt: number;
}

export interface Delegate {
  username: string;
  address: string;
  publicKey: string;
  votes: string;
  rank: number;
  isResigned: boolean;
  approval?: number;
  producedBlocks?: number;
}

export interface ApiTransaction {
  id: string;
  blockId?: string;
  version: number;
  type: number;
  typeGroup: number;
  amount: string;
  fee: string;
  sender: string;
  senderPublicKey: string;
  recipient?: string;
  vendorField?: string;
  asset?: any;
  confirmations?: number;
  timestamp?: { epoch: number; unix: number; human: string };
  nonce?: string;
  /** Mainsail: the transaction ran but reverted (receipt status 0); the fee was still paid */
  failed?: boolean;
  /** Mainsail: from an EVM chain (labels say validator, addresses compare without case) */
  evm?: boolean;
}

export type TxKind =
  | "transfer"
  | "multipayment"
  | "vote"
  | "secondSignature"
  | "delegateRegistration"
  | "delegateResignation"
  // Mainsail only
  | "validatorRegistration"
  | "validatorUpdate"
  | "validatorResignation"
  | "usernameRegistration"
  | "usernameResignation";

export interface TxDraft {
  kind: TxKind;
  title: string;
  /** Rows shown in the confirmation summary */
  summary: [string, string][];
  /** Fields passed to the Rust builder (besides keys/fee/nonce) */
  fields: {
    amount?: string;
    recipientId?: string;
    vendorField?: string;
    payments?: { amount: string; recipientId: string }[];
    votes?: string[];
    username?: string;
  };
  /** Extra amount leaving the wallet besides the fee (arktoshi) */
  total: bigint;
  /** For secondSignature registration */
  needsNewSecondPassphrase?: boolean;
  /** Mainsail: the call to make (when absent it is worked out from kind + fields) */
  call?: MsCall;
}

/** Mainsail: what a transaction calls (mirrors mainsail::CallRequest in Rust). Amounts in arktoshi. */
export interface MsCall {
  kind: "transfer" | "multipayment" | "vote" | "unvote" | "validatorRegistration" | "validatorUpdate" | "validatorResignation" | "usernameRegistration" | "usernameResignation";
  amount?: string;
  recipientId?: string;
  memo?: string;
  payments?: { amount: string; recipientId: string }[];
  vote?: string;
  username?: string;
  legacyRegistration?: boolean;
}
