<script lang="ts">
  import Sym from "./Sym.svelte";
  import Modal from "./Modal.svelte";
  import SecretInput from "./SecretInput.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { ark, type NodeFeeConfig } from "../lib/ark";
  import { backend, openExternal } from "../lib/backend";
  import { feeOptions, type SizeParams } from "../lib/fees";
  import { formatArk, formatFiat, parseArk } from "../lib/format";
  import { NETWORKS, type TxDraft, type WalletEntry } from "../lib/types";

  let {
    wallet,
    draft,
    newSecondPassphrase = "",
    onclose,
    ondone,
  }: {
    wallet: WalletEntry;
    draft: TxDraft;
    newSecondPassphrase?: string;
    onclose: () => void;
    ondone?: (id: string) => void;
  } = $props();

  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);
  const hasSecond = $derived(!!data?.secondPublicKey);

  let cfg = $state<NodeFeeConfig | null>(null);
  let cfgError = $state("");
  let choice = $state<"min" | "avg" | "custom">(app.settings.feeChoice);
  let customFee = $state("");
  let passphrase = $state("");
  let secondPassphrase = $state("");
  let busy = $state(false);
  let error = $state("");
  let result = $state<{ id: string; accepted: boolean; message: string } | null>(null);

  $effect(() => {
    ark
      .fees(app.apiUrl(wallet.network))
      .then((c) => (cfg = c))
      .catch((e) => (cfgError = String(e?.message ?? e)));
  });

  const sizeParams = $derived<SizeParams>({
    kind: draft.kind,
    vendorField: draft.fields.vendorField,
    payments: draft.fields.payments?.length,
    votes: draft.fields.votes?.length,
    username: draft.fields.username,
    hasSecondSignature: hasSecond,
  });
  const opts = $derived(cfg ? feeOptions(cfg, sizeParams) : null);

  const fee = $derived.by<bigint | null>(() => {
    if (!opts) return null;
    if (choice === "min") return opts.min;
    if (choice === "avg") return opts.avg;
    return parseArk(customFee);
  });
  const feeTooLow = $derived(fee !== null && opts !== null && fee < opts.min);
  const total = $derived(fee !== null ? draft.total + fee : null);
  const balance = $derived(BigInt(data?.balance ?? "0"));
  const insufficient = $derived(total !== null && total > balance);

  function pick(c: "min" | "avg" | "custom") {
    choice = c;
    if (c === "custom") {
      if (!customFee && opts) customFee = formatArk(opts.avg, 8, 0).replace(/,/g, "");
    } else {
      app.setFeeChoice(c); // remembered as the default for future transactions
    }
  }

  function fiat(v: bigint | null) {
    const f = v === null ? null : app.fiatValue(wallet.network, v);
    return f === null ? "" : formatFiat(f, app.settings.currency);
  }

  const canSubmit = $derived(
    !busy && !!opts && fee !== null && fee > 0n && !feeTooLow && !insufficient && passphrase.trim().length > 0 &&
      (!hasSecond || secondPassphrase.trim().length > 0),
  );

  async function submit() {
    if (!canSubmit || fee === null) return;
    busy = true;
    error = "";
    const nonce = app.nextNonce(wallet.address);
    try {
      const built = await backend.buildTransaction({
        network: net.pubKeyHash,
        kind: draft.kind,
        nonce,
        fee: fee.toString(),
        ...draft.fields,
        expectedAddress: wallet.address,
        expectedSecondPublicKey: data?.secondPublicKey ?? null,
        passphrase,
        secondPassphrase: hasSecond ? secondPassphrase : null,
        newSecondPassphrase: newSecondPassphrase || null,
      });
      passphrase = "";
      secondPassphrase = "";
      const res = await ark.broadcast(app.apiUrl(wallet.network), built.tx);
      result = { id: built.tx.id, ...res };
      if (res.accepted) {
        app.markBroadcast(wallet.address, nonce);
        app.toast("ok", `${draft.title} sent`, { label: "View in explorer", url: app.explorerTx(wallet.network, built.tx.id) });
        ondone?.(built.tx.id);
      }
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={result ? (result.accepted ? "Transaction sent" : "Transaction rejected") : draft.title} {onclose} width={560}>
  {#if result}
    <div class="stack fade">
      {#if result.accepted}
        <div class="done">
          <div class="ok-icon"><Icon name="check" size={28} /></div>
          <div>
            <div style="font-weight:600">Accepted by the network</div>
            <div class="muted small">It will be confirmed in the next block or two (~8 s each).</div>
          </div>
        </div>
      {:else}
        <div class="notice error">{result.message}</div>
      {/if}
      <div class="kv">
        <span class="muted">Transaction ID</span>
        <div class="row">
          <span class="mono ellipsis" style="max-width:380px">{result.id}</span>
          <CopyButton text={result.id} />
        </div>
      </div>
      <div class="row">
        <button class="btn" onclick={() => openExternal(app.explorerTx(wallet.network, result!.id))}>
          <Icon name="external" size={14} /> Open in explorer
        </button>
        <span class="spacer"></span>
        <button class="btn primary" onclick={onclose}>Done</button>
      </div>
    </div>
  {:else}
    <div class="stack">
      <div class="summary">
        <div class="kv"><span class="muted">From</span><span>{wallet.name} <span class="mono faint">{wallet.address}</span></span></div>
        {#each draft.summary as [k, v]}
          <div class="kv"><span class="muted">{k}</span><span class="val">{#each v.split("  ≈ ") as part, i}{#if i > 0}  ≈ <span class="usd">{part}</span>{:else if part.endsWith(" " + net.token) && /\d/.test(part)}{part.slice(0, -net.token.length - 1)}<Sym network={wallet.network} />{:else}{part}{/if}{/each}</span></div>
        {/each}
      </div>

      <div class="fee-box">
        <div class="row">
          <h3>Fee</h3>
          <span class="spacer"></span>
          {#if opts}<span class="faint small">{opts.size} bytes</span>{/if}
        </div>
        {#if cfgError}
          <div class="notice error">Could not load network fees: {cfgError}</div>
        {:else if !opts}
          <div class="row muted"><span class="spinner"></span> Calculating fees…</div>
        {:else}
          <div class="fee-opts">
            <button class="fee-opt" class:on={choice === "min"} onclick={() => pick("min")}>
              <span class="lbl">Minimum</span>
              <span class="amt num">{formatArk(opts.min, 8, 0)}<Sym network={wallet.network} /></span>
              <span class="sub" class:usd={!!fiat(opts.min)}>{fiat(opts.min) || "lowest the network accepts"}</span>
            </button>
            <button class="fee-opt" class:on={choice === "avg"} onclick={() => pick("avg")}>
              <span class="lbl">Average</span>
              <span class="amt num">{formatArk(opts.avg, 8, 0)}<Sym network={wallet.network} /></span>
              <span class="sub" class:usd={!opts.avgIsStatic && !!fiat(opts.avg)}>{opts.avgIsStatic ? "no recent data · network default" : fiat(opts.avg) || "7-day average"}</span>
            </button>
            <button class="fee-opt" class:on={choice === "custom"} onclick={() => pick("custom")}>
              <span class="lbl">Custom</span>
              {#if choice === "custom"}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="custom num"
                  bind:value={customFee}
                  class:invalid={feeTooLow || fee === null}
                  onclick={(e) => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <span class="amt faint">set your own</span>
              {/if}
              <span class="sub">min {formatArk(opts.min, 8, 0)}</span>
            </button>
          </div>
          <div class="faint small">
            Your Minimum / Average choice is remembered for future transactions.
          </div>
          {#if feeTooLow}<div class="notice warn">The fee is below the network minimum and would be rejected.</div>{/if}
        {/if}
      </div>

      {#if total !== null}
        <div class="total">
          <span class="muted">Total</span>
          <span class="spacer"></span>
          <span class="num" style="font-weight:600">{formatArk(total, 8, 2)}<Sym network={wallet.network} /></span>
          {#if fiat(total)}<span class="small">≈ <span class="usd">{fiat(total)}</span></span>{/if}
        </div>
        {#if insufficient}
          <div class="notice error">Insufficient balance: the wallet holds {formatArk(balance)}<Sym network={wallet.network} />.</div>
        {/if}
      {/if}

      <label class="field">
        Passphrase
        <SecretInput bind:value={passphrase} autofocus />
      </label>
      {#if hasSecond}
        <label class="field">
          Second passphrase
          <SecretInput bind:value={secondPassphrase} placeholder="This wallet requires its second passphrase" />
        </label>
      {/if}
      <div class="faint small row"><Icon name="lock" size={13} /> Passphrases are used only to sign this transaction and are never saved.</div>

      {#if error}<div class="notice error">{error}</div>{/if}

      <div class="row">
        <span class="spacer"></span>
        <button class="btn" onclick={onclose}>Cancel</button>
        <button class="btn primary" disabled={!canSubmit} onclick={submit}>
          {#if busy}<span class="spinner"></span> Signing…{:else}<Icon name="send" size={14} /> Sign & send{/if}
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .summary {
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .kv {
    display: flex;
    gap: 14px;
    justify-content: space-between;
    align-items: baseline;
  }
  .kv > :first-child {
    flex-shrink: 0;
  }
  .kv .val {
    text-align: right;
    word-break: break-all;
  }
  .fee-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fee-opts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .fee-opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: var(--card);
    text-align: left;
    min-height: 76px;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .fee-opt:hover {
    background: var(--card-hover);
  }
  .fee-opt.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .fee-opt .lbl {
    font-size: 12px;
    color: var(--muted);
    font-weight: 600;
  }
  .fee-opt.on .lbl {
    color: var(--accent);
  }
  .fee-opt .amt {
    font-weight: 600;
  }
  .fee-opt .sub.usd {
    color: var(--green);
  }
  .fee-opt .sub {
    font-size: 11.5px;
    color: var(--faint);
  }
  .custom {
    padding: 3px 7px;
    font-size: 13px;
    margin: 1px 0;
  }
  .total {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--card);
  }
  .done {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .ok-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--green-soft);
    color: var(--green);
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
