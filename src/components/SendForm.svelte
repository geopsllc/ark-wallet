<script lang="ts">
  import Sym from "./Sym.svelte";
  import ConfirmTx from "./ConfirmTx.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { ark, type NodeFeeConfig } from "../lib/ark";
  import { backend } from "../lib/backend";
  import { feeOptions } from "../lib/fees";
  import { formatArk, formatFiat, parseArk, shortAddress, utf8Length } from "../lib/format";
  import { NETWORKS, type TxDraft, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();

  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);
  const balance = $derived(BigInt(data?.balance ?? "0"));

  let mode = $state<"single" | "multi">("single");
  let recipient = $state("");
  let amount = $state("");
  let rows = $state([
    { recipient: "", amount: "" },
    { recipient: "", amount: "" },
  ]);
  let memo = $state("");
  let error = $state("");
  let draft = $state<TxDraft | null>(null);
  let cfg = $state<NodeFeeConfig | null>(null);

  $effect(() => {
    ark.fees(app.apiUrl(wallet.network)).then((c) => (cfg = c)).catch(() => {});
  });

  const memoBytes = $derived(utf8Length(memo.trim()));
  const memoTooLong = $derived(memoBytes > 255);

  const contacts = $derived(app.wallets.filter((w) => w.network === wallet.network && w.id !== wallet.id));

  const est = $derived(
    cfg
      ? feeOptions(cfg, {
          kind: mode === "single" ? "transfer" : "multipayment",
          vendorField: memo,
          payments: rows.length,
          hasSecondSignature: !!data?.secondPublicKey,
        })
      : null,
  );
  const defaultFee = $derived(est ? (app.settings.feeChoice === "min" ? est.min : est.avg) : null);

  const sum = $derived.by(() => {
    if (mode === "single") return parseArk(amount) ?? 0n;
    return rows.reduce((s, r) => s + (parseArk(r.amount) ?? 0n), 0n);
  });

  function sendMax() {
    if (defaultFee === null) return;
    const max = balance - defaultFee;
    amount = max > 0n ? formatArk(max, 8, 0).replace(/,/g, "") : "0";
  }

  function fiat(v: bigint) {
    const f = app.fiatValue(wallet.network, v);
    return f === null ? "" : formatFiat(f, app.settings.currency);
  }

  function nameFor(addr: string) {
    const w = app.wallets.find((x) => x.address === addr.trim());
    return w ? `${w.name} (${shortAddress(addr, 5)})` : addr.trim();
  }

  async function review() {
    error = "";
    if (memoTooLong) return (error = "Memo is longer than 255 bytes");
    const vendorField = memo.trim() || undefined;
    if (mode === "single") {
      const r = recipient.trim();
      if (!(await backend.validateAddress(r, net.pubKeyHash)))
        return (error = `Not a valid ${net.name} address (should start with "${net.addressPrefix}")`);
      const a = parseArk(amount);
      if (!a || a <= 0n) return (error = "Enter an amount greater than zero");
      draft = {
        kind: "transfer",
        title: `Send ${net.token}`,
        summary: [
          ["To", nameFor(r)],
          ["Amount", `${formatArk(a, 8)} ${net.token}${fiat(a) ? "  ≈ " + fiat(a) : ""}`],
          ...(vendorField ? ([["Memo", vendorField]] as [string, string][]) : []),
        ],
        fields: { amount: a.toString(), recipientId: r, vendorField },
        total: a,
      };
    } else {
      if (rows.length < 2) return (error = "A multipayment needs at least 2 recipients");
      const payments: { amount: string; recipientId: string }[] = [];
      for (const [i, row] of rows.entries()) {
        const r = row.recipient.trim();
        if (!(await backend.validateAddress(r, net.pubKeyHash))) return (error = `Row ${i + 1}: invalid ${net.name} address`);
        const a = parseArk(row.amount);
        if (!a || a <= 0n) return (error = `Row ${i + 1}: enter an amount greater than zero`);
        payments.push({ recipientId: r, amount: a.toString() });
      }
      draft = {
        kind: "multipayment",
        title: `Multipayment to ${payments.length} recipients`,
        summary: [
          ...payments.map((p, i) => [`#${i + 1} ${nameFor(p.recipientId)}`, `${formatArk(p.amount, 8)} ${net.token}`] as [string, string]),
          ["Amount", `${formatArk(sum, 8)} ${net.token}${fiat(sum) ? "  ≈ " + fiat(sum) : ""}`],
          ...(vendorField ? ([["Memo", vendorField]] as [string, string][]) : []),
        ],
        fields: { payments, vendorField },
        total: sum,
      };
    }
  }

  function reset() {
    recipient = "";
    amount = "";
    memo = "";
    rows = [
      { recipient: "", amount: "" },
      { recipient: "", amount: "" },
    ];
  }
</script>

<div class="send stack">
  <div class="row">
    <div class="seg">
      <button class:on={mode === "single"} onclick={() => (mode = "single")}>Transfer</button>
      <button class:on={mode === "multi"} onclick={() => (mode = "multi")}>Multipayment</button>
    </div>
    <span class="spacer"></span>
    <span class="muted small">Available: <span class="num">{formatArk(balance)}<Sym network={wallet.network} /></span></span>
  </div>

  <datalist id="own-{wallet.id}">
    {#each contacts as c}<option value={c.address}>{c.name}</option>{/each}
  </datalist>

  {#if mode === "single"}
    <label class="field">
      Recipient
      <input bind:value={recipient} placeholder="{net.addressPrefix}… address" list="own-{wallet.id}" class="mono" spellcheck="false" />
    </label>
    <label class="field">
      Amount ({net.token})
      <div class="row">
        <input bind:value={amount} placeholder="0.00" inputmode="decimal" class="num" />
        <button class="btn" onclick={sendMax} disabled={defaultFee === null}>Max</button>
      </div>
      {#if fiat(sum)}<span class="small">≈ <span class="usd">{fiat(sum)}</span></span>{/if}
    </label>
  {:else}
    <div class="multi">
      {#each rows as row, i (i)}
        <div class="mrow">
          <span class="idx faint num">{i + 1}</span>
          <input bind:value={row.recipient} placeholder="{net.addressPrefix}… address" list="own-{wallet.id}" class="mono" spellcheck="false" />
          <input bind:value={row.amount} placeholder="Amount" inputmode="decimal" class="num amt" />
          <button class="btn ghost icon" disabled={rows.length <= 2} onclick={() => rows.splice(i, 1)} title="Remove">
            <Icon name="x" size={14} />
          </button>
        </div>
      {/each}
      <div class="row">
        <button class="btn small" disabled={rows.length >= 64} onclick={() => rows.push({ recipient: "", amount: "" })}>
          <Icon name="plus" size={13} /> Add recipient
        </button>
        <span class="faint small">{rows.length} / 64</span>
        <span class="spacer"></span>
        <span class="muted small">Total: <span class="num">{formatArk(sum)}<Sym network={wallet.network} /></span> {#if fiat(sum)}≈ <span class="usd">{fiat(sum)}</span>{/if}</span>
      </div>
    </div>
  {/if}

  <label class="field">
    <span class="row">Memo (vendor field) <span class="spacer"></span>
      <span class="num" class:red={memoTooLong} class:faint={!memoTooLong}>{memoBytes} / 255 bytes</span>
    </span>
    <input bind:value={memo} placeholder="Optional public message" class:invalid={memoTooLong} />
  </label>

  {#if est}
    <div class="estimate small">
      <Icon name="layers" size={13} />
      <span>Size <b class="num">{est.size}</b> bytes</span>
      <span class="dot">·</span>
      <span>Minimum fee <b class="num">{formatArk(est.min, 8, 0)}</b></span>
      <span class="dot">·</span>
      <span>Average <b class="num">{formatArk(est.avg, 8, 0)}<Sym network={wallet.network} /></b></span>
      {#if memoBytes > 0}<span class="faint">(memo adds {memoBytes} bytes)</span>{/if}
    </div>
  {/if}

  {#if error}<div class="notice error">{error}</div>{/if}

  <div class="row">
    <span class="spacer"></span>
    <button class="btn primary" onclick={review} disabled={!data}>
      Review <Icon name="chevron" size={14} />
    </button>
  </div>
</div>

{#if draft}
  <ConfirmTx {wallet} {draft} onclose={() => (draft = null)} ondone={reset} />
{/if}

<style>
  .send {
    max-width: 640px;
  }
  .multi {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mrow {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .mrow .idx {
    width: 18px;
    text-align: right;
    font-size: 12px;
  }
  .mrow .amt {
    width: 150px;
    flex-shrink: 0;
  }
  .estimate {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 11px;
  }
  .estimate b {
    color: var(--text);
    font-weight: 600;
  }
  .dot {
    color: var(--faint);
  }
</style>
