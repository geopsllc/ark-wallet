<script lang="ts">
  import Pager from "./Pager.svelte";
  import PartyName from "./PartyName.svelte";
  import Sym from "./Sym.svelte";
  import Icon from "./Icon.svelte";
  import DelegateName from "./DelegateName.svelte";
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { openExternal } from "../lib/backend";
  import { formatArk, formatDate, shortAddress, timeAgo } from "../lib/format";
  import { NETWORKS, type ApiTransaction, type WalletEntry } from "../lib/types";
  import { describeTx } from "../lib/txinfo";

  let { wallet }: { wallet: WalletEntry } = $props();
  const net = $derived(NETWORKS[wallet.network]);

  let filter = $state<"all" | "sent" | "received">("all");
  let page = $state(1);
  let pageCount = $state(1);
  let total = $state(0);
  let txs = $state<ApiTransaction[]>([]);
  let loading = $state(false);
  let error = $state("");

  async function load() {
    loading = true;
    error = "";
    try {
      // transient API failures are retried automatically inside ark.* (see lib/retry.ts)
      const r = await ark.transactions(app.apiUrl(wallet.network), wallet.address, page, filter);
      txs = r.data;
      pageCount = Math.max(1, r.pageCount);
      total = r.totalCount;
    } catch (e: any) {
      error = String(e?.message ?? e);
      txs = [];
      total = 0;
      pageCount = 1;
    } finally {
      loading = false;
    }
  }

  // reload when page / filter / wallet changes, and whenever the wallet's data refreshes
  $effect(() => {
    void page;
    void filter;
    void wallet.address;
    void app.data[wallet.address]?.nonce;
    void app.data[wallet.address]?.balance;
    load();
  });

  function setFilter(f: typeof filter) {
    filter = f;
    page = 1;
  }

  const describe = (t: ApiTransaction) => describeTx(t, wallet.address);

  /** Multipayment recipient to name in the row: one of your other wallets if it's among them, else the first. */
  function shownRecipient(payments: { recipientId: string }[]): string {
    const own = new Set(app.wallets.filter((w) => w.address !== wallet.address).map((w) => w.address));
    return (payments.find((p) => own.has(p.recipientId)) ?? payments.find((p) => p.recipientId === wallet.address) ?? payments[0]).recipientId;
  }

</script>

<div class="stack">
  <div class="row" style="flex-wrap:wrap; row-gap:8px">
    <div class="seg">
      <button class:on={filter === "all"} onclick={() => setFilter("all")}>All</button>
      <button class:on={filter === "received"} onclick={() => setFilter("received")}>Received</button>
      <button class:on={filter === "sent"} onclick={() => setFilter("sent")}>Sent</button>
    </div>
    <span class="faint small num">{total.toLocaleString()} transactions</span>
    <span class="spacer"></span>
    {#if loading}<span class="spinner"></span>{/if}
    <Pager bind:page {pageCount} />
  </div>

  {#if error}
    <div class="notice error row">
      <span>Could not load transactions: {error}</span>
      <span class="spacer"></span>
      <button class="btn small" onclick={load}><Icon name="refresh" size={13} /> Retry</button>
    </div>
  {/if}

  <div class="panel tablebox" style="overflow:hidden">
    <table class="list">
      <thead>
        <tr>
          <th>Transaction</th>
          <th class="c-id">Tx ID</th>
          <th class="c-memo">Memo</th>
          <th class="right c-amt">Amount</th>
          <th class="right c-date">Date</th>
        </tr>
      </thead>
      <tbody>
        {#each txs as t (t.id)}
          {@const r = describe(t)}
          {@const payments = (t.asset?.payments ?? []) as { recipientId: string }[]}
          <tr>
            <td>
              <div class="row" style="gap:11px">
                <div class="ticon {r.dir}"><Icon name={r.icon} size={15} /></div>
                <div style="min-width:0">
                  <div class="row" style="gap:6px">
                    <span style="font-weight:500">{r.label}</span>
                    {#if (t.confirmations ?? 1) < 1}<span class="badge warn">Pending</span>{/if}
                  </div>
                  <div class="faint small ellipsis">
                    {#if r.votes}
                      {#each r.votes as v, i}{i > 0 ? " → " : ""}{v[0] === "+" ? "for " : "from "}<DelegateName network={wallet.network} publicKey={v.slice(1)} link />{/each}
                    {:else if r.counterparty}
                      {r.dir === "in" ? "from" : "to"} <PartyName network={wallet.network} address={r.counterparty} />
                    {:else if payments.length}
                      to <PartyName network={wallet.network} address={shownRecipient(payments)} />{#if payments.length > 1}<span>&nbsp;+ {payments.length - 1} more</span>{/if}
                    {:else}
                      by <PartyName network={wallet.network} address={t.sender} />
                    {/if}
                  </div>
                </div>
              </div>
            </td>
            <td class="c-id">
              <button
                class="xlink mono txid"
                title="{t.id} · open in explorer"
                onclick={() => openExternal(app.explorerTx(wallet.network, t.id))}
              >{shortAddress(t.id, 6)}<Icon name="external" size={11} /></button>
            </td>
            <td class="c-memo memo muted" title={t.vendorField ?? ""}>{t.vendorField ?? ""}</td>
            <td class="right num c-amt">
              {#if r.amount !== 0n}
                <div class:green={r.amount > 0n} class:red={r.amount < 0n} style="font-weight:500">
                  {r.amount > 0n ? "+" : "−"}{formatArk(r.amount < 0n ? -r.amount : r.amount)}<Sym network={wallet.network} />
                </div>
              {/if}
              <div class="faint small" title={t.sender === wallet.address ? "Fee you paid" : "Fee paid by the sender"}>
                fee {formatArk(t.fee, 8, 0)}<Sym network={wallet.network} />{t.sender === wallet.address ? "" : " (sender)"}
              </div>
            </td>
            <td class="right c-date">
              {#if t.timestamp}
                {@const when = new Date(t.timestamp.unix * 1000)}
                <div class="small" title={formatDate(t.timestamp.unix)}>{timeAgo(t.timestamp.unix)}</div>
                <div class="faint small">
                  {Date.now() / 1000 - t.timestamp.unix < 86400 * 30
                    ? when.toLocaleDateString()
                    : when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </div>
              {/if}
            </td>
          </tr>
        {:else}
          {#if !loading}
            <tr><td colspan="5" class="muted" style="text-align:center;padding:40px">No transactions yet</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
  {#if pageCount > 1 && txs.length}
    <div class="row bottom-pager"><span class="spacer"></span><Pager bind:page {pageCount} /></div>
  {/if}
</div>

<style>
  .bottom-pager {
    margin-top: -4px;
  }
  .txid {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--accent);
  }
  .memo {
    font-size: 12.5px;
  }
  /* Fixed columns: Tx ID 150 + Amount 178 + Date 104 = 432px. Memo takes 24%; the Transaction column
     gets the rest and needs ~260px for "Multipayment received" and a full from/to line. Columns hide
     (memo, then date, then tx id) exactly when keeping them would squeeze the Transaction column below that. */
  .c-id {
    width: 150px;
  }
  .c-memo {
    width: 24%;
  }
  .c-amt {
    width: 178px;
  }
  .c-date {
    width: 104px;
  }
  @container (max-width: 910px) {
    .c-memo {
      display: none;
    }
  }
  @container (max-width: 700px) {
    .c-date {
      display: none;
    }
  }
  @container (max-width: 596px) {
    .c-id {
      display: none;
    }
  }
  .ticon {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.05);
    color: var(--muted);
  }
  .ticon.in {
    background: var(--green-soft);
    color: var(--green);
  }
  .ticon.out {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
