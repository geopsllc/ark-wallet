<script lang="ts">
  import ConfirmTx from "./ConfirmTx.svelte";
  import Icon from "./Icon.svelte";
  import MnemonicSetup from "./MnemonicSetup.svelte";
  import { app } from "../lib/state.svelte";
  import { ark, ApiError } from "../lib/ark";
  import { formatArk } from "../lib/format";
  import { NETWORKS, type TxDraft, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();
  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);

  let draft = $state<TxDraft | null>(null);
  let newSecond = $state("");
  let settingUpSecond = $state(false);

  // delegate registration
  let username = $state("");
  let nameStatus = $state<"" | "checking" | "taken" | "free" | "invalid">("");
  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  const validName = (u: string) => /^[a-z0-9!@$&_.]{1,20}$/.test(u);

  function onName() {
    clearTimeout(nameTimer);
    const u = username.trim();
    if (!u) return (nameStatus = "");
    if (!validName(u)) return (nameStatus = "invalid");
    nameStatus = "checking";
    nameTimer = setTimeout(async () => {
      try {
        await ark.delegate(app.apiUrl(wallet.network), u);
        if (username.trim() === u) nameStatus = "taken";
      } catch (e) {
        if (username.trim() === u) nameStatus = e instanceof ApiError && e.status === 404 ? "free" : "";
      }
    }, 350);
  }

  function register() {
    const u = username.trim();
    draft = {
      kind: "delegateRegistration",
      title: "Register as delegate",
      summary: [["Delegate name", u]],
      fields: { username: u },
      total: 0n,
    };
  }

  function resign() {
    draft = {
      kind: "delegateResignation",
      title: "Resign delegate",
      summary: [
        ["Delegate", data?.delegate?.username ?? ""],
        ["Warning", "Resignation is permanent and cannot be undone"],
      ],
      fields: {},
      total: 0n,
    };
  }

  function secondReady(phrase: string) {
    newSecond = phrase;
    settingUpSecond = false;
    draft = {
      kind: "secondSignature",
      title: "Register second passphrase",
      summary: [["Effect", "All future transactions from this wallet will need both passphrases"]],
      fields: {},
      total: 0n,
      needsNewSecondPassphrase: true,
    };
  }

  function closeDraft() {
    draft = null;
    newSecond = "";
  }
</script>

<div class="grid">
  <section class="card stack">
    <div class="row"><Icon name="key" /><h2>Second passphrase</h2></div>
    {#if data?.secondPublicKey}
      <div class="notice ok">This wallet is protected by a second passphrase. Every transaction needs both passphrases.</div>
      <div class="faint small mono" style="word-break:break-all">Second public key: {data.secondPublicKey}</div>
    {:else}
      <p class="muted" style="margin:0">
        Add a second passphrase as an extra signature on every transaction. It cannot be removed or changed later, so
        store it as carefully as the first.
      </p>
      {#if settingUpSecond}
        <MnemonicSetup words={12} confirmLabel="Continue" oncancel={() => (settingUpSecond = false)} ondone={secondReady} />
      {:else}
        <div><button class="btn" disabled={!data || data.coldWallet && data.balance === "0"} onclick={() => (settingUpSecond = true)}>Set up second passphrase</button></div>
      {/if}
    {/if}
  </section>

  <section class="card stack">
    <div class="row"><Icon name="star" /><h2>Delegate</h2></div>
    {#if data?.delegate}
      <div class="row">
        <span style="font-size:16px;font-weight:600">{data.delegate.username}</span>
        {#if data.delegate.resigned}<span class="badge red">Resigned</span>
        {:else if (data.delegate.rank ?? 999) <= 51}<span class="badge green">Active · #{data.delegate.rank}</span>
        {:else}<span class="badge warn">Standby · #{data.delegate.rank}</span>{/if}
      </div>
      {#if data.delegate.voteBalance}
        <div class="muted small">Vote weight: <span class="num">{formatArk(data.delegate.voteBalance, 0, 0)} {net.token}</span></div>
      {/if}
      {#if !data.delegate.resigned}
        <div class="notice warn">Resigning permanently removes this delegate from forging. It cannot be undone.</div>
        <div><button class="btn danger" onclick={resign}>Resign delegate</button></div>
      {/if}
    {:else}
      <p class="muted" style="margin:0">Register this wallet as a delegate. The name is permanent: 1–20 lowercase letters, digits or <span class="mono">!@$&_.</span></p>
      <label class="field">
        Delegate name
        <input bind:value={username} oninput={onName} placeholder="mydelegate" class:invalid={nameStatus === "invalid" || nameStatus === "taken"} spellcheck="false" />
      </label>
      <div class="small">
        {#if nameStatus === "checking"}<span class="muted">Checking availability…</span>
        {:else if nameStatus === "taken"}<span class="red">That name is taken</span>
        {:else if nameStatus === "free"}<span class="green">Available</span>
        {:else if nameStatus === "invalid"}<span class="red">Use 1–20 lowercase letters, digits or !@$&_.</span>{/if}
      </div>
      <div><button class="btn primary" disabled={nameStatus !== "free" || !data} onclick={register}>Register delegate</button></div>
    {/if}
  </section>
</div>

{#if draft}
  <ConfirmTx {wallet} {draft} newSecondPassphrase={newSecond} onclose={closeDraft} />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
    align-items: start;
  }
</style>
