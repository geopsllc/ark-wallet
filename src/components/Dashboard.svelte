<script lang="ts">
  import Icon from "./Icon.svelte";
  import PriceChart from "./PriceChart.svelte";
  import DelegateName from "./DelegateName.svelte";
  import WalletAvatar from "./WalletAvatar.svelte";
  import Address from "./Address.svelte";
  import { walletColor } from "../lib/colors";
  import { app } from "../lib/state.svelte";
  import { formatArk, formatFiat, shortAddress } from "../lib/format";
  import { NETWORKS } from "../lib/types";

  let { onadd }: { onadd: () => void } = $props();

  const cur = $derived(app.settings.currency);
  const mainnetWallets = $derived(app.wallets.filter((w) => w.network === "mainnet"));
  const totalArk = $derived(app.portfolioArk);
  const totalFiat = $derived(app.portfolioFiat);
  const delegateArk = $derived(app.delegateArk);
  const voting = $derived(mainnetWallets.filter((w) => app.data[w.address]?.vote).length);

  function compact(n?: number) {
    if (n === undefined) return "—";
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
  }
</script>

<div class="dash stack">
  <div class="row">
    <h1>Dashboard</h1>
    <span class="spacer"></span>
    <button class="btn ghost" onclick={() => { app.refreshAll(); app.refreshPrice(); }}><Icon name="refresh" size={14} /> Refresh</button>
  </div>

  <div class="top">
    <div class="card portfolio">
      <div class="muted small one" title="Mainnet wallets, excluding delegate wallets">Total balance</div>
      <div class="big num">{formatArk(totalArk, 4, 2)} <span class="tok">ARK</span></div>
      <div class="fiat num">{totalFiat !== null ? formatFiat(totalFiat, cur) : "—"}</div>
      {#if delegateArk > 0n}
        <div class="faint small num one" title="Delegate balances are paid out to voters, so they're kept out of the total">
          Excludes {formatArk(delegateArk, 2, 2)} ARK in delegates
        </div>
      {/if}
      <div class="meta">
        <div><span class="faint small">Wallets</span><b class="num">{app.wallets.length}</b></div>
        <div><span class="faint small">Voting</span><b class="num">{voting} / {mainnetWallets.length}</b></div>
      </div>
    </div>

    <div class="card price">
      <div class="row">
        <div>
          <div class="muted small">ARK price</div>
          <div class="row" style="gap:10px;align-items:baseline">
            <span class="pv num">{app.price ? formatFiat(app.price.price, cur) : "—"}</span>
            {#if app.price}
              <span class="num chg" class:green={app.price.change24h >= 0} class:red={app.price.change24h < 0}>
                {app.price.change24h >= 0 ? "▲" : "▼"} {Math.abs(app.price.change24h).toFixed(2)}% 24h
              </span>
            {/if}
          </div>
        </div>
        <span class="spacer"></span>
        <div class="mk">
          <div><span class="faint small">Market cap</span><span class="num">{compact(app.price?.marketCap)}</span></div>
          <div><span class="faint small">24h volume</span><span class="num">{compact(app.price?.volume24h)}</span></div>
        </div>
      </div>
      {#if app.priceError}<div class="notice warn small">Price unavailable: {app.priceError}</div>{/if}
      <PriceChart points={app.history} currency={cur} height={110} />
      <div class="faint small" style="text-align:right">Data: CoinGecko</div>
    </div>
  </div>

  <div class="row" style="margin-top:6px">
    <h2>Wallets</h2>
    <span class="spacer"></span>
    <button class="btn primary" onclick={onadd}><Icon name="plus" size={14} /> Add wallet</button>
  </div>

  {#if app.wallets.length === 0}
    <div class="card emptystate">
      <div class="eicon"><Icon name="wallet" size={26} /></div>
      <h2>Build your wallet collection</h2>
      <p class="muted">Add an address to watch, import with a passphrase, or create a brand-new wallet. Passphrases are never stored.</p>
      <button class="btn primary" onclick={onadd}><Icon name="plus" size={14} /> Add your first wallet</button>
    </div>
  {:else}
    <div class="grid">
      {#each app.wallets as w (w.id)}
        {@const d = app.data[w.address]}
        {@const f = app.fiatValue(w.network, d?.balance)}
        <button class="card wcard" style="--wc:{walletColor(w.address)}" onclick={() => (app.view = { name: "wallet", id: w.id })}>
          <div class="row">
            <WalletAvatar name={w.name} address={w.address} size={26} />
            <span class="wn ellipsis">{w.name}</span>
            {#if w.network !== "mainnet"}<span class="badge warn">{NETWORKS[w.network].name}</span>{/if}
            {#if d?.delegate}<span class="badge brand">Delegate</span>{/if}
          </div>
          <div class="faint small"><Address address={w.address} /></div>
          <div class="wb num">{d ? formatArk(d.balance, 4, 2) : "…"} <span class="tok small">{NETWORKS[w.network].token}</span></div>
          <div class="row small">
            <span class="fiatv num">{f !== null ? formatFiat(f, cur) : ""}</span>
            <span class="spacer"></span>
            {#if d?.vote}
              <span class="muted"><Icon name="vote" size={12} /> <DelegateName network={w.network} publicKey={d.vote} /></span>
            {:else if d}
              <span class="faint">not voting</span>
            {/if}
          </div>
          {#if app.errors[w.address]}<div class="red small ellipsis">{app.errors[w.address]}</div>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dash {
    gap: 16px;
  }
  .top {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) 2fr;
    gap: 16px;
  }
  .one {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .portfolio {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: linear-gradient(165deg, rgba(115, 191, 255, 0.12), var(--card) 60%);
  }
  .big {
    font-size: 30px;
    font-weight: 650;
    letter-spacing: -0.02em;
    margin-top: 4px;
  }
  .tok {
    font-size: 16px;
    color: var(--muted);
    font-weight: 500;
  }
  .fiat {
    font-size: 16px;
    color: var(--accent);
  }
  .meta {
    display: flex;
    gap: 26px;
    margin-top: auto;
    padding-top: 16px;
  }
  .meta div,
  .mk div {
    display: flex;
    flex-direction: column;
  }
  .price {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pv {
    font-size: 24px;
    font-weight: 650;
  }
  .chg {
    font-size: 13px;
    font-weight: 600;
  }
  .mk {
    display: flex;
    gap: 22px;
    text-align: right;
  }
  .mk div {
    align-items: flex-end;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .wcard {
    text-align: left;
    border-top: 3px solid var(--wc);
    background: linear-gradient(170deg, color-mix(in srgb, var(--wc) 10%, var(--card)), var(--card) 55%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px;
    transition:
      border-color 0.12s,
      transform 0.12s,
      background 0.12s;
  }
  .wcard:hover {
    border-color: rgba(115, 191, 255, 0.4);
    background: var(--card-hover);
  }
  .wn {
    font-weight: 600;
  }
  .tok {
    color: var(--accent);
    font-weight: 500;
  }
  .fiatv {
    color: var(--green);
    font-weight: 500;
  }
  .wb {
    font-size: 19px;
    font-weight: 600;
    margin-top: 6px;
  }
  .emptystate {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 46px 20px;
    gap: 6px;
  }
  .emptystate p {
    max-width: 440px;
  }
  .eicon {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }
</style>
