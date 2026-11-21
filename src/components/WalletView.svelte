<script lang="ts">
  import Sym from "./Sym.svelte";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";
  import DelegateName from "./DelegateName.svelte";
  import TransactionList from "./TransactionList.svelte";
  import SendForm from "./SendForm.svelte";
  import VotePanel from "./VotePanel.svelte";
  import MessageTools from "./MessageTools.svelte";
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import Modal from "./Modal.svelte";
  import WalletName from "./WalletName.svelte";
  import { app } from "../lib/state.svelte";
  import { openExternal } from "../lib/backend";
  import { formatArk, formatFiat } from "../lib/format";
  import { NETWORKS, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();

  type Tab = "tx" | "send" | "vote" | "message" | "advanced";
  let tab = $state<Tab>("tx");
  let editing = $state(false);
  let newName = $state("");
  let confirmRemove = $state(false);

  const net = $derived(NETWORKS[wallet.network]);
  const d = $derived(app.data[wallet.address]);
  const fiat = $derived(app.fiatValue(wallet.network, d?.balance));

  // reset to transactions tab when switching wallets
  let lastId = "";
  $effect(() => {
    if (wallet.id !== lastId) {
      lastId = wallet.id;
      tab = "tx";
      editing = false;
    }
  });

  function startEdit() {
    newName = wallet.name;
    editing = true;
  }
  function saveName() {
    app.renameWallet(wallet.id, newName);
    editing = false;
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "tx", label: "Transactions", icon: "list" },
    { id: "send", label: "Send", icon: "send" },
    { id: "vote", label: "Vote", icon: "vote" },
    { id: "message", label: "Sign / Verify", icon: "message" },
    { id: "advanced", label: "Delegate & Security", icon: "shield" },
  ];
</script>

<div class="stack" style="gap:18px">
  <div class="card head">
    <div class="row">
      {#if editing}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="name-input"
          bind:value={newName}
          onkeydown={(e) => {
            if (e.key === "Enter") saveName();
            if (e.key === "Escape") editing = false;
          }}
          onblur={saveName}
          autofocus
        />
      {:else}
        <h1 class="hname"><WalletName {wallet} size="lg" /></h1>
        <button class="btn ghost icon" title="Rename" onclick={startEdit}><Icon name="edit" size={14} /></button>
      {/if}
      <span class="badge" class:brand={wallet.network === "mainnet"} class:warn={wallet.network !== "mainnet"}>{net.name}</span>
      {#if d?.delegate}<span class="badge brand">Delegate · {d.delegate.username}</span>{/if}
      {#if d?.secondPublicKey}<span class="badge green"><Icon name="key" size={11} /> 2nd passphrase</span>{/if}
      {#if d?.coldWallet}<span class="badge" title="No outgoing transactions yet; public key unknown to the network">Cold wallet</span>{/if}
      <span class="spacer"></span>
      <button class="btn ghost icon" title="Refresh" onclick={() => app.refreshWallet(wallet)}>
        {#if app.loading[wallet.address]}<span class="spinner"></span>{:else}<Icon name="refresh" size={15} />{/if}
      </button>
      <button class="btn ghost icon" title="Move up" onclick={() => app.moveWallet(wallet.id, -1)}><Icon name="up" size={15} /></button>
      <button class="btn ghost icon" title="Move down" onclick={() => app.moveWallet(wallet.id, 1)}><Icon name="down" size={15} /></button>
      <button class="btn ghost icon" title="Remove from collection" onclick={() => (confirmRemove = true)}><Icon name="trash" size={15} /></button>
    </div>

    <div class="row addr">
      <span class="mono">{wallet.address}</span>
      <CopyButton text={wallet.address} />
      <button class="btn ghost icon" title="Open in explorer" onclick={() => openExternal(app.explorerAddress(wallet.network, wallet.address))}>
        <Icon name="external" size={14} />
      </button>
    </div>

    <div class="balance-row">
      <div>
        <div class="bal num">{d ? formatArk(d.balance, 8, 2) : "…"} <Sym network={wallet.network} /></div>
        <div class="fiat num">{fiat !== null ? formatFiat(fiat, app.settings.currency) : net.hasFiatValue ? "" : "Test network: no market value"}</div>
      </div>
      <span class="spacer"></span>
      <div class="vote-box">
        <span class="faint small">Voting for</span>
        {#if d?.vote}
          <button class="linkish" onclick={() => (tab = "vote")}><DelegateName network={wallet.network} publicKey={d.vote} /></button>
        {:else}
          <button class="linkish muted" onclick={() => (tab = "vote")}>Nobody: vote now</button>
        {/if}
      </div>
      <div class="actions">
        <button class="btn primary" onclick={() => (tab = "send")}><Icon name="send" size={14} /> Send</button>
        <button class="btn" onclick={() => (tab = "vote")}><Icon name="vote" size={14} /> Vote</button>
      </div>
    </div>
    {#if app.errors[wallet.address]}
      <div class="notice error">Could not load wallet: {app.errors[wallet.address]}</div>
    {/if}
  </div>

  <div class="tabs">
    {#each tabs as t}
      <button class="tab" class:active={tab === t.id} onclick={() => (tab = t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>
    {/each}
  </div>

  <div class="fade">
    {#key wallet.id}
      {#if tab === "tx"}<TransactionList {wallet} />
      {:else if tab === "send"}<SendForm {wallet} />
      {:else if tab === "vote"}<VotePanel {wallet} />
      {:else if tab === "message"}<MessageTools {wallet} />
      {:else}<AdvancedPanel {wallet} />{/if}
    {/key}
  </div>
</div>

{#if confirmRemove}
  <Modal title="Remove wallet" onclose={() => (confirmRemove = false)} width={440}>
    <div class="stack">
      <p style="margin:0">Remove <b>{wallet.name}</b> from your collection?</p>
      <p class="muted small" style="margin:0">
        This only removes it from this app. The funds stay on the blockchain, and you can add the address again any time.
      </p>
      <div class="row">
        <span class="spacer"></span>
        <button class="btn" onclick={() => (confirmRemove = false)}>Cancel</button>
        <button class="btn danger" onclick={() => { confirmRemove = false; app.removeWallet(wallet.id); }}>Remove</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 18px 20px;
    background: linear-gradient(170deg, rgba(115, 191, 255, 0.08), var(--card) 55%);
  }
  .head h1 {
    max-width: 420px;
  }
  .hname {
    display: flex;
    min-width: 0;
  }
  .name-input {
    width: 320px;
    font-size: 18px;
    font-weight: 600;
    padding: 4px 8px;
  }
  .addr {
    gap: 2px;
    color: var(--muted);
  }
  .balance-row {
    display: flex;
    align-items: flex-end;
    gap: 26px;
    margin-top: 8px;
  }
  .bal {
    font-size: 30px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .fiat {
    color: var(--green);
    font-size: 15px;
    min-height: 20px;
  }
  .vote-box {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    font-weight: 600;
    font-size: 14px;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
</style>
