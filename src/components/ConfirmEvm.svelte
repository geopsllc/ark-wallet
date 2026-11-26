<script lang="ts">
  // Mainsail (EVM) confirmation: gas instead of bytes, signed in Rust as an EIP-155 transaction and
  // posted to the network's transaction API. Same look as the Core confirmation (ConfirmTx).
  import Sym from "./Sym.svelte";
  import Modal from "./Modal.svelte";
  import SecretInput from "./SecretInput.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { backend, openExternal } from "../lib/backend";
  import { gasFee, ms, VALIDATOR_GAS } from "../lib/mainsail";
  import { formatArk } from "../lib/format";
  import { NETWORKS, type MsCall, type TxDraft, type WalletEntry } from "../lib/types";

  let {
    wallet,
    draft,
    validatorPassphrase = "",
    onclose,
    ondone,
  }: {
    wallet: WalletEntry;
    draft: TxDraft;
    /** BIP39 mnemonic of the validator's BLS key: validator registration / key update only */
    validatorPassphrase?: string;
    onclose: () => void;
    ondone?: (id: string) => void;
  } = $props();

  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);
  const hasSecond = $derived(!!data?.secondPublicKey);

  /** The contract call this draft makes. */
  function callOf(d: TxDraft): MsCall {
    if (d.call) return d.call;
    const f = d.fields;
    switch (d.kind) {
      case "transfer":
        return { kind: "transfer", amount: f.amount, recipientId: f.recipientId, memo: f.vendorField };
      case "multipayment":
        return { kind: "multipayment", payments: f.payments };
      case "vote": {
        const plus = (f.votes ?? []).find((v) => v.startsWith("+"));
        return plus ? { kind: "vote", vote: plus.slice(1) } : { kind: "unvote" };
      }
      default:
        return { kind: d.kind as MsCall["kind"], username: f.username };
    }
  }

  const isValidatorKey = (k: string) => k === "validatorRegistration" || k === "validatorUpdate";

  let call = $state<MsCall | null>(null);
  let gas = $state<{ minPrice: bigint; avgPrice: bigint; maxLimit: number } | null>(null);
  let gasLimit = $state<number | null>(null);
  let prepError = $state("");
  let choice = $state<"min" | "avg" | "custom">(app.settings.feeChoice);
  let customGwei = $state("");
  let passphrase = $state("");
  let secondPassphrase = $state("");
  let busy = $state(false);
  let error = $state("");
  let result = $state<{ id: string; accepted: boolean; message: string } | null>(null);

  // Work out the call and its gas: the node estimates it by running the call (so a call that would
  // fail, like voting for the validator you already vote for, is caught before signing). Validator
  // key operations check a BLS proof the estimate cannot have, so they use a fixed, ample limit.
  $effect(() => {
    const base = app.apiUrl(wallet.network);
    const rpc = app.rpcUrl(wallet.network);
    const c = { ...callOf(draft) };
    (async () => {
      try {
        const g = await ms.gas(base);
        gas = g;
        if (isValidatorKey(c.kind)) c.legacyRegistration = await ms.legacyValidatorAbi(rpc);
        call = c;
        if (isValidatorKey(c.kind) || c.kind === "validatorResignation") {
          gasLimit = VALIDATOR_GAS;
          return;
        }
        const info = await backend.msDescribeCall(c);
        let est: number;
        try {
          est = await ms.estimateGas(rpc, {
            from: wallet.address,
            to: info.to,
            value: "0x" + BigInt(info.value).toString(16),
            data: info.data,
          });
        } catch (e: any) {
          throw new Error(`The network says this transaction would fail: ${e?.message ?? e}`);
        }
        // a plain transfer always costs what it is estimated at; contract calls get headroom
        const plain = c.kind === "transfer" && info.data.length <= 2 + 2 * 255 && est <= 21000 + 16 * 255;
        gasLimit = Math.min(g.maxLimit, plain ? est : Math.ceil(est * 1.25));
      } catch (e: any) {
        prepError = String(e?.message ?? e);
      }
    })();
  });

  const minGwei = $derived(gas ? Number(gas.minPrice) / 1e9 : 5);
  const gasPrice = $derived.by<bigint | null>(() => {
    if (!gas) return null;
    if (choice === "min") return gas.minPrice;
    if (choice === "avg") return gas.avgPrice;
    const g = Number(customGwei.replace(",", "."));
    if (!Number.isFinite(g) || g <= 0) return null;
    return BigInt(Math.round(g * 1e9));
  });
  const priceTooLow = $derived(gasPrice !== null && gas !== null && gasPrice < gas.minPrice);
  const fee = $derived(gasPrice !== null && gasLimit !== null ? gasFee(gasLimit, gasPrice) : null);
  const total = $derived(fee !== null ? draft.total + fee : null);
  const balance = $derived(BigInt(data?.balance ?? "0"));
  const insufficient = $derived(total !== null && total > balance);

  function pick(c: "min" | "avg" | "custom") {
    choice = c;
    if (c === "custom") {
      if (!customGwei && gas) customGwei = String(Number(gas.avgPrice) / 1e9);
    } else {
      app.setFeeChoice(c);
    }
  }

  const feeFor = (price: bigint) => (gasLimit !== null ? gasFee(gasLimit, price) : null);
  const gwei = (p: bigint) => `${(Number(p) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 })} gwei`;

  const canSubmit = $derived(
    !busy && !!call && gasLimit !== null && gasPrice !== null && !priceTooLow && !insufficient && passphrase.trim().length > 0 &&
      (!hasSecond || secondPassphrase.trim().length > 0) && (!isValidatorKey(call.kind) || validatorPassphrase.trim().length > 0),
  );

  async function submit() {
    if (!canSubmit || !call || gasPrice === null || gasLimit === null) return;
    busy = true;
    error = "";
    const nonce = app.nextNonce(wallet.address, wallet.network);
    try {
      const signed = await backend.msBuildTransaction({
        ...call,
        chainId: net.chainId,
        nonce,
        gasPrice: gasPrice.toString(),
        gasLimit: String(gasLimit),
        passphrase,
        secondPassphrase: hasSecond ? secondPassphrase : null,
        validatorPassphrase: isValidatorKey(call.kind) ? validatorPassphrase : null,
        expectedAddress: wallet.address,
        expectedSecondPublicKey: data?.secondPublicKey ?? null,
      });
      passphrase = "";
      secondPassphrase = "";
      const res = await ms.broadcast(app.txApiUrl(wallet.network), signed.serialized);
      result = { id: signed.hash, ...res };
      if (res.accepted) {
        app.markBroadcast(wallet.address, nonce);
        app.toast("ok", `${draft.title} sent`, { label: "View in explorer", url: app.explorerTx(wallet.network, signed.hash) });
        ondone?.(signed.hash);
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
        <span class="muted">Transaction hash</span>
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
          <div class="kv"><span class="muted">{k}</span><span class="val">{#if v.endsWith(" " + net.token) && /\d/.test(v)}{v.slice(0, -net.token.length - 1)}<Sym network={wallet.network} />{:else}{v}{/if}</span></div>
        {/each}
      </div>

      <div class="fee-box">
        <div class="row">
          <h3>Fee</h3>
          <span class="spacer"></span>
          {#if gasLimit !== null}<span class="faint small">gas limit {gasLimit.toLocaleString()}{gasPrice !== null ? ` · ${gwei(gasPrice)}` : ""}</span>{/if}
        </div>
        {#if prepError}
          <div class="notice error">{prepError}</div>
        {:else if !gas || gasLimit === null}
          <div class="row muted"><span class="spinner"></span> Estimating gas…</div>
        {:else}
          <div class="fee-opts">
            <button class="fee-opt" class:on={choice === "min"} onclick={() => pick("min")}>
              <span class="lbl">Minimum</span>
              <span class="amt num">{formatArk(feeFor(gas.minPrice), 8, 0)}<Sym network={wallet.network} /></span>
              <span class="sub">{gwei(gas.minPrice)} · lowest accepted</span>
            </button>
            <button class="fee-opt" class:on={choice === "avg"} onclick={() => pick("avg")}>
              <span class="lbl">Average</span>
              <span class="amt num">{formatArk(feeFor(gas.avgPrice), 8, 0)}<Sym network={wallet.network} /></span>
              <span class="sub">{gwei(gas.avgPrice)} · recent average</span>
            </button>
            <button class="fee-opt" class:on={choice === "custom"} onclick={() => pick("custom")}>
              <span class="lbl">Custom gas price</span>
              {#if choice === "custom"}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="custom num"
                  bind:value={customGwei}
                  class:invalid={priceTooLow || gasPrice === null}
                  onclick={(e) => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <span class="amt faint">set your own</span>
              {/if}
              <span class="sub">gwei · min {minGwei}</span>
            </button>
          </div>
          <div class="faint small">
            This is the most it can cost: you pay only for the gas the transaction uses.
          </div>
          {#if priceTooLow}<div class="notice warn">The gas price is below the network minimum and would be rejected.</div>{/if}
        {/if}
      </div>

      {#if total !== null}
        <div class="total">
          <span class="muted">Total (at most)</span>
          <span class="spacer"></span>
          <span class="num" style="font-weight:600">{formatArk(total, 8, 2)}<Sym network={wallet.network} /></span>
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
    overflow-wrap: anywhere;
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
