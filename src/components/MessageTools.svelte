<script lang="ts">
  import SecretInput from "./SecretInput.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Icon from "./Icon.svelte";
  import { backend } from "../lib/backend";
  import { NETWORKS, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();
  const net = $derived(NETWORKS[wallet.network]);
  const evm = $derived(net.family === "mainsail");

  let mode = $state<"sign" | "verify">("sign");

  // sign
  let message = $state("");
  let passphrase = $state("");
  let signed = $state<{ message: string; publicKey: string; signature: string } | null>(null);
  let signError = $state("");
  let busy = $state(false);

  async function sign() {
    signError = "";
    signed = null;
    busy = true;
    try {
      signed = evm
        ? await backend.msSignMessage(message, passphrase, wallet.address)
        : await backend.signMessage(message, passphrase, wallet.address, net.pubKeyHash);
      passphrase = "";
    } catch (e: any) {
      signError = String(e?.message ?? e);
    } finally {
      busy = false;
    }
  }

  const signedJson = $derived(signed ? JSON.stringify(signed, null, 2) : "");

  // verify
  let vJson = $state("");
  let vMessage = $state("");
  let vKey = $state("");
  let vSig = $state("");
  let vResult = $state<{ ok: boolean; address?: string } | null>(null);
  let vError = $state("");

  function parseJson() {
    vError = "";
    try {
      const o = JSON.parse(vJson);
      vMessage = o.message ?? "";
      vKey = o.publicKey ?? o.publickey ?? (evm ? o.address ?? "" : "");
      vSig = o.signature ?? "";
    } catch {
      vError = "That is not valid JSON";
    }
  }

  async function verify() {
    vError = "";
    vResult = null;
    try {
      const key = vKey.trim();
      const ok = evm ? await backend.msVerifyMessage(vMessage, key, vSig.trim()) : await backend.verifyMessage(vMessage, key, vSig);
      let address: string | undefined;
      try {
        if (evm) address = key.startsWith("0x") && key.length === 42 ? key : await backend.msAddressFromPublicKey(key);
        else address = await backend.addressFromPublicKey(key, net.pubKeyHash);
      } catch {}
      vResult = { ok, address };
    } catch (e: any) {
      vError = String(e?.message ?? e);
    }
  }
</script>

<div class="stack" style="max-width:640px">
  <div class="seg" style="align-self:flex-start">
    <button class:on={mode === "sign"} onclick={() => (mode = "sign")}>Sign message</button>
    <button class:on={mode === "verify"} onclick={() => (mode = "verify")}>Verify message</button>
  </div>

  {#if mode === "sign"}
    <p class="muted small" style="margin:0">Prove you control <span class="mono">{wallet.address}</span> by signing a message. Signing is free and nothing is sent to the network.{#if evm} The signature is Ethereum-style (EIP-191), so EVM tools can check it too.{/if}</p>
    <label class="field">Message<textarea bind:value={message} rows="3" placeholder="Text to sign"></textarea></label>
    <label class="field">Passphrase<SecretInput bind:value={passphrase} /></label>
    {#if signError}<div class="notice error">{signError}</div>{/if}
    <div class="row">
      <span class="spacer"></span>
      <button class="btn primary" disabled={!message || !passphrase || busy} onclick={sign}><Icon name="edit" size={14} /> Sign</button>
    </div>
    {#if signed}
      <div class="out fade">
        <div class="row"><h3>Signed message</h3><span class="spacer"></span><CopyButton text={signedJson} label="Copy JSON" /></div>
        <pre class="mono">{signedJson}</pre>
      </div>
    {/if}
  {:else}
    <label class="field">
      Paste signed JSON (optional)
      <textarea bind:value={vJson} rows="4" class="mono" placeholder={'{ "message": "...", "publicKey": "...", "signature": "..." }'} oninput={parseJson}></textarea>
    </label>
    <label class="field">Message<textarea bind:value={vMessage} rows="2"></textarea></label>
    <label class="field">{evm ? "Public key or address" : "Public key"}<input bind:value={vKey} class="mono" spellcheck="false" /></label>
    <label class="field">Signature<input bind:value={vSig} class="mono" spellcheck="false" /></label>
    {#if vError}<div class="notice error">{vError}</div>{/if}
    <div class="row">
      <span class="spacer"></span>
      <button class="btn primary" disabled={!vMessage || !vKey || !vSig} onclick={verify}><Icon name="check" size={14} /> Verify</button>
    </div>
    {#if vResult}
      <div class="notice fade {vResult.ok ? 'ok' : 'error'}">
        {#if vResult.ok}
          Valid signature{vResult.address ? ` from ${vResult.address}` : ""}.
        {:else}
          The signature does NOT match this message and {evm ? "signer" : "public key"}.
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .out {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  pre {
    margin: 0;
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 12px;
  }
</style>
