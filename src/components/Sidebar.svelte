<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { formatArk, formatFiat } from "../lib/format";
  import { NETWORKS } from "../lib/types";

  let { onadd }: { onadd: () => void } = $props();

</script>

<aside>
  <div class="brand">
    <svg width="34" height="28" viewBox="4.5 6.5 23 19" aria-hidden="true">
      <path fill="#F70000" d="M15.947 13.347L5 24.89 15.996 7 27 25 15.947 13.347zm1.588 4.585h-3.422l1.76-1.936 1.662 1.953v-.017zm-6.6 3.177v-.024l1.941-1.987v-.009l5.92-.025 1.998 2.045h-9.858z" />
    </svg>
    <span>ARK Wallet</span>
  </div>

  <div class="total">
    <div class="faint small">Portfolio</div>
    <div class="tv num">{app.portfolioFiat !== null ? formatFiat(app.portfolioFiat, app.settings.currency) : "—"}</div>
    <div class="muted small num">{formatArk(app.portfolioArk, 2, 2)} ARK</div>
  </div>

  <nav>
    <button class="nav" class:active={app.view.name === "dashboard"} onclick={() => (app.view = { name: "dashboard" })}>
      <Icon name="home" size={16} /> Dashboard
    </button>
  </nav>

  <div class="section row">
    <span>Wallets</span>
    <span class="spacer"></span>
    <button class="btn ghost icon add" title="Add wallet" onclick={onadd}><Icon name="plus" size={15} /></button>
  </div>

  <div class="wallets">
    {#each app.wallets as w (w.id)}
      {@const d = app.data[w.address]}
      <button
        class="wallet"
        class:active={app.view.name === "wallet" && app.view.id === w.id}
        onclick={() => (app.view = { name: "wallet", id: w.id })}
      >
        <div class="row" style="gap:6px">
          <span class="wname ellipsis">{w.name}</span>
          {#if w.network !== "mainnet"}<span class="badge warn">{NETWORKS[w.network].name}</span>{/if}
          <span class="spacer"></span>
          {#if app.loading[w.address] && !d}<span class="spinner" style="width:10px;height:10px"></span>{/if}
          {#if app.errors[w.address]}<span class="red" title={app.errors[w.address]}>!</span>{/if}
        </div>
        <div class="wbal num">
          {d ? formatArk(d.balance, 2, 2) : "…"} <span class="faint">{NETWORKS[w.network].token}</span>
        </div>
      </button>
    {:else}
      <div class="empty faint small">No wallets yet</div>
    {/each}
  </div>

  <button class="nav settings" class:active={app.view.name === "settings"} onclick={() => (app.view = { name: "settings" })}>
    <Icon name="settings" size={16} /> Settings
  </button>
</aside>

<style>
  aside {
    width: 248px;
    flex-shrink: 0;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 14px 10px 10px;
    gap: 6px;
    min-height: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 700;
    font-size: 15px;
    padding: 4px 8px 10px;
    letter-spacing: -0.01em;
  }
  .total {
    margin: 0 4px 8px;
    padding: 12px 12px;
    border-radius: 12px;
    background: linear-gradient(160deg, rgba(115, 191, 255, 0.13), rgba(115, 191, 255, 0.03));
    border: 1px solid rgba(115, 191, 255, 0.16);
  }
  .tv {
    font-size: 21px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 500;
    text-align: left;
  }
  .nav:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
  }
  .nav.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .section {
    padding: 10px 10px 2px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--faint);
    font-weight: 600;
  }
  .add {
    width: 24px;
    height: 24px;
  }
  .wallets {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
  }
  .wallet {
    background: none;
    border: 1px solid transparent;
    border-radius: 9px;
    padding: 8px 10px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .wallet:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .wallet.active {
    background: var(--card);
    border-color: rgba(115, 191, 255, 0.45);
  }
  .wname {
    font-weight: 500;
    max-width: 150px;
  }
  .wbal {
    font-size: 12.5px;
    color: var(--muted);
  }
  .wallet.active .wbal {
    color: var(--text);
  }
  .empty {
    padding: 8px 10px;
  }
  .settings {
    margin-top: 4px;
    border-top: 1px solid var(--border);
    border-radius: 0 0 8px 8px;
    padding-top: 12px;
  }
</style>
