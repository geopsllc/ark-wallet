export type NetworkId = "mainnet" | "devnet";

export interface NetworkDef {
  id: NetworkId;
  name: string;
  pubKeyHash: number;
  token: string;
  symbol: string;
  defaultApi: string;
  explorer: string;
  addressPrefix: string;
  hasFiatValue: boolean;
}

export const NETWORKS: Record<NetworkId, NetworkDef> = {
  mainnet: {
    id: "mainnet",
    name: "Mainnet",
    pubKeyHash: 23,
    token: "ARK",
    symbol: "Ѧ",
    defaultApi: "https://api.ark.io/api",
    explorer: "https://ark.geops.net",
    addressPrefix: "A",
    hasFiatValue: true,
  },
  devnet: {
    id: "devnet",
    name: "Devnet",
    pubKeyHash: 30,
    token: "DARK",
    symbol: "DѦ",
    defaultApi: "https://dwallets.ark.io/api",
    explorer: "https://test.arkscan.io",
    addressPrefix: "D",
    hasFiatValue: false,
  },
};

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
  delegate: { username: string; rank?: number; resigned?: boolean; voteBalance?: string } | null;
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
}

export type TxKind =
  | "transfer"
  | "multipayment"
  | "vote"
  | "secondSignature"
  | "delegateRegistration"
  | "delegateResignation";

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
}
