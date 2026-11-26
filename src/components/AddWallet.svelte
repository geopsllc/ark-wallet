<script lang="ts">
  import Modal from "./Modal.svelte";
  import SecretInput from "./SecretInput.svelte";
  import MnemonicSetup from "./MnemonicSetup.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { deriveWallet, invalidAddressText, normalizeAddress } from "../lib/chain";
  import { NETWORKS, type NetworkId } from "../lib/types";

  let { onclose }: { onclose: () => void } = $props();

  let mode = $state<"address" | "passphrase" | "create">("address");
  let network = $state<NetworkId>("mainnet");
  let name = $state("");
  let address = $state("");
  let passphrase = $state("");
  let found = $state<{ address: string; publicKey: string } | null>(null);
  let error = $state("");
  let creating = $state(false);

  const net = $derived(NETWORKS[network]);
  const defaultName = $derived(`Wallet ${app.wallets.length + 1}`);

  let deriveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = passphrase;
    const n = network;
    clearTimeout(deriveTimer);
    found = null;
    if (mode !== "passphrase" || !p.trim()) return;
    deriveTimer = setTimeout(async () => {
      const d = await deriveWallet(n, p).catch(() => null);
      // only the result for what is in the field now (an older, slower answer would be the wrong address)
      if (passphrase === p && network === n && mode === "passphrase") found = d;
    }, 200);
  });

  function finishAdd(addr: string, publicKey?: string) {
    const w = app.addWallet({ name: name.trim(), address: addr, network, publicKey });
    if (w) {
      app.view = { name: "wallet", id: w.id };
      app.toast("ok", "Wallet added");
      onclose();
    }
  }

  async function add() {
    error = "";
    if (mode === "address") {
      const a = await normalizeAddress(network, address);
      if (!a) {
        error = invalidAddressText(network);
        return;
      }
      finishAdd(a);
    } else if (mode === "passphrase") {
      if (!found) return;
      const d = found;
      passphrase = "";
      finishAdd(d.address, d.publicKey);
    }
  }

  async function created(mnemonic: string) {
    const d = await deriveWallet(network, mnemonic);
    finishAdd(d.address, d.publicKey);
  }
</script>

<Modal title="Add wallet" {onclose} width={600}>
  <div class="stack">
    <div class="tabs">
      <button class="tab" class:active={mode === "address"} onclick={() => (mode = "address")}><Icon name="eye" size={14} /> Address</button>
      <button class="tab" class:active={mode === "passphrase"} onclick={() => (mode = "passphrase")}><Icon name="key" size={14} /> Import passphrase</button>
      <button class="tab" class:active={mode === "create"} onclick={() => (mode = "create")}><Icon name="plus" size={14} /> Create new</button>
    </div>

    <div class="two">
      <label class="field">
        Network
        <select bind:value={network}>
          {#each Object.values(NETWORKS) as n}<option value={n.id}>{n.name} ({n.token})</option>{/each}
        </select>
      </label>
      <label class="field">Name<input bind:value={name} placeholder="{defaultName} (or {net.producer} name)" /></label>
    </div>

    {#if mode === "address"}
      <label class="field">
        Address
        <input bind:value={address} placeholder="{net.addressPrefix}…" class="mono" spellcheck="false" />
      </label>
      <p class="muted small" style="margin:0">
        Only the address is saved. You'll be asked for the passphrase whenever you send, vote or sign.
      </p>
    {:else if mode === "passphrase"}
      <label class="field">
        Passphrase
        <SecretInput bind:value={passphrase} placeholder="12 or 24 words, or any ARK passphrase" autofocus />
      </label>
      {#if found}
        <div class="found fade">
          <span class="muted small">Address</span>
          <span class="mono">{found.address}</span>
        </div>
      {/if}
      <p class="faint small row" style="margin:0"><Icon name="lock" size={13} /> The passphrase is only used to work out the address. It is not saved.</p>
    {:else if !creating}
      <p class="muted" style="margin:0">Generate a new BIP39 passphrase for a brand-new {net.name} wallet.</p>
      <div><button class="btn primary" onclick={() => (creating = true)}>Generate passphrase</button></div>
    {:else}
      <MnemonicSetup confirmLabel="Create wallet" oncancel={() => (creating = false)} ondone={created} />
    {/if}

    {#if error}<div class="notice error">{error}</div>{/if}

    {#if mode !== "create"}
      <div class="row">
        <span class="spacer"></span>
        <button class="btn" onclick={onclose}>Cancel</button>
        <button class="btn primary" disabled={mode === "address" ? !address.trim() : !found} onclick={add}>Add wallet</button>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .found {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 9px 12px;
  }
</style>
