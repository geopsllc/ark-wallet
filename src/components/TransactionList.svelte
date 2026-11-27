<script lang="ts">
  import Pager from "./Pager.svelte";
  import PartyName from "./PartyName.svelte";
  import Sym from "./Sym.svelte";
  import Icon from "./Icon.svelte";
  import DelegateName from "./DelegateName.svelte";
  import { app, TX_PAGE_SIZES } from "../lib/state.svelte";
  import { tick } from "svelte";
  import { chain, sameAddress } from "../lib/chain";
  import { RateLimitError } from "../lib/retry";
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

  // Total for the current wallet + filter; lets deep pages be read from the cheaper end (see ark.transactions)
  let totalKey = "";
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryIn = $state(0);

  async function load() {
    const my = ++seq; // only the latest request may update the table (fast page clicks overlap)
    clearTimeout(retryTimer);
    retryIn = 0;
    loading = true;
    error = "";
    const key = `${wallet.address}|${filter}`;
    try {
      // transient API failures are retried automatically inside ark.* (see lib/retry.ts)
      const r = await chain(wallet.network).transactions(
        app.apiUrl(wallet.network), wallet.address, page, filter, app.txPageSize, key === totalKey ? total : 0,
      );
      if (my !== seq) return;
      txs = r.data;
      pageCount = Math.max(1, r.pageCount);
      total = r.totalCount;
      totalKey = key;
    } catch (e: any) {
      if (my !== seq) return;
      error = String(e?.message ?? e);
      txs = [];
      // keep the pager as it was, so another page can still be picked
      if (key !== totalKey) {
        total = 0;
        pageCount = 1;
      }
      if (e instanceof RateLimitError) {
        // try again by itself as soon as the API allows it
        retryIn = Math.ceil(e.seconds);
        const countdown = () => {
          if (my !== seq) return;
          if (--retryIn <= 0) load();
          else retryTimer = setTimeout(countdown, 1000);
        };
        retryTimer = setTimeout(countdown, 1000);
      }
    } finally {
      if (my === seq) loading = false;
    }
  }

  $effect(() => () => {
    seq++;
    clearTimeout(retryTimer);
  });

  // reload when page / filter / wallet changes, and whenever the wallet's data refreshes
  $effect(() => {
    void page;
    void filter;
    void app.txPageSize;
    void wallet.address;
    void app.data[wallet.address]?.nonce;
    void app.data[wallet.address]?.balance;
    load();
  });

  // Keep the toolbar on one line. First the transaction count gives way; if that is not enough,
  // the pager shows fewer page numbers. Both come back when there is room. Each check runs
  // before the browser paints, so there is no visible flicker.
  let bar = $state<HTMLDivElement>();
  let countEl = $state<HTMLSpanElement>();
  let showCount = $state(true);
  let compact = $state(false);
  let fitting = false;

  function wraps(): boolean {
    if (!bar) return false;
    const items = [...bar.children].filter(
      (el) => !el.classList.contains("spacer") && (el as HTMLElement).offsetParent !== null,
    ) as HTMLElement[];
    if (items.length < 2) return false;
    const mid = (el: HTMLElement) => el.offsetTop + el.offsetHeight / 2;
    const first = mid(items[0]);
    return items.some((el) => Math.abs(mid(el) - first) > 4);
  }

  let again = false;
  async function fit() {
    if (!bar) return;
    if (fitting) {
      again = true; // a resize or page change arrived mid-check: run once more afterwards
      return;
    }
    fitting = true;
    do {
      again = false;
      showCount = true;
      compact = false;
      await tick();
      if (wraps()) {
        showCount = false;
        await tick();
        if (wraps()) {
          compact = true;
          await tick();
        }
      }
    } while (again);
    fitting = false;
  }

  $effect(() => {
    if (!bar) return;
    let lastW = -1;
    const ro = new ResizeObserver(() => {
      const w = bar!.clientWidth;
      if (w !== lastW) {
        lastW = w;
        fit();
      }
    });
    ro.observe(bar);
    return () => ro.disconnect();
  });
  // the pager's width changes with the page numbers; re-check whenever they change
  $effect(() => {
    void page;
    void pageCount;
    void total;
    void app.txPageSize;
    fit();
  });

  /** Change rows per page, staying on the page that holds the first row you were looking at. */
  function setPageSize(n: number) {
    const first = (page - 1) * app.txPageSize;
    app.setTxPageSize(n);
    page = Math.floor(first / n) + 1;
  }

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

<div class="stack fitlist">
  <div class="row" style="flex-wrap:wrap; row-gap:8px" bind:this={bar}>
    <div class="seg">
      <button class:on={filter === "all"} onclick={() => setFilter("all")}>All</button>
      <button class:on={filter === "received"} onclick={() => setFilter("received")}>Received</button>
      <button class:on={filter === "sent"} onclick={() => setFilter("sent")}>Sent</button>
    </div>
    <span class="faint small num count" class:gone={!showCount} bind:this={countEl}>{total.toLocaleString()} transactions</span>
    <span class="spacer"></span>
    <!-- fixed slot so the spinner never changes the toolbar's width -->
    <span class="spin-slot">{#if loading}<span class="spinner"></span>{/if}</span>
    <Pager bind:page {pageCount} span={compact ? 1 : 2} />
    <select class="psize" title="Transactions per page" value={app.txPageSize} onchange={(e) => setPageSize(+e.currentTarget.value)}>
      {#each TX_PAGE_SIZES as n}<option value={n}>{n} rows</option>{/each}
    </select>
  </div>

  {#if error}
    <div class="notice error row">
      <span>Could not load transactions: {retryIn ? error.replace(/Try again in \d+s\./, `Retrying in ${retryIn}s…`) : error}</span>
      <span class="spacer"></span>
      <button class="btn small" onclick={load}><Icon name="refresh" size={13} /> Retry</button>
    </div>
  {/if}

  <div class="panel tablebox">
    <table class="list">
      <thead>
        <tr>
          <th class="c-tx">Transaction</th>
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
                      {#each r.votes.filter((v) => v.length > 1) as v, i}{i > 0 ? " → " : ""}{v[0] === "+" ? "for " : "from "}<DelegateName network={wallet.network} publicKey={v.slice(1)} link />{/each}
                    {:else if r.counterparty}
                      {r.dir === "in" ? "from" : "to"} <PartyName network={wallet.network} address={r.counterparty} />
                    {:else if payments.length}
                      <span class="mp"><span class="mp-to">to&nbsp;</span><PartyName network={wallet.network} address={shownRecipient(payments)} />{#if payments.length > 1}<span class="mp-more">&nbsp;+ {payments.length - 1} more</span>{/if}</span>
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
            <td class="c-memo memo muted" title={t.vendorField ?? ""}><div class="clamp2">{t.vendorField ?? ""}</div></td>
            <td class="right num c-amt">
              {#if r.amount !== 0n}
                <div class:green={r.amount > 0n} class:red={r.amount < 0n} style="font-weight:500">
                  {r.amount > 0n ? "+" : "−"}{formatArk(r.amount < 0n ? -r.amount : r.amount)}<Sym network={wallet.network} />
                </div>
              {/if}
              <div class="faint small" title={t.sender === wallet.address ? "Fee you paid" : "Fee paid by the sender"}>
                fee {formatArk(t.fee, 8, 0)}<Sym network={wallet.network} />{sameAddress(t.sender, wallet.address) ? "" : " (sender)"}
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
</div>

<style>
  /* multipayment line: the recipient shrinks (with "…") before "+ N more" is ever cut */
  .mp {
    display: flex;
    min-width: 0;
  }
  .mp-to,
  .mp-more {
    flex-shrink: 0;
  }
  .count.gone {
    display: none;
  }
  .spin-slot {
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .psize {
    width: auto;
    height: 24px;
    padding: 0 20px 0 7px;
    font-size: 11.5px;
    background-position:
      calc(100% - 12px) 50%,
      calc(100% - 8px) 50%;
    background-size:
      4px 4px,
      4px 4px;
    border-radius: 6px;
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
  /* memos wrap onto a second line, and only then truncate (a row is already two lines tall) */
  .clamp2 {
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    line-height: 1.35;
  }
  /* Column plan: Memo is exactly wide enough for "Thanks for your votes" on one line (127px of text + 24px
     padding = 152px; longer memos wrap onto a second line), Tx ID 144 + Amount 216 (fits a Mainsail gas fee
     plus "(sender)") + Date 104 are fixed, and Transaction takes whatever is left. Memo shows while
     Transaction can keep >= 200px (200 + 152 + 464 = 816, so it still shows in a 1120px window). Date and Tx ID drop out when keeping them
     would push Transaction below 228px. */
  .c-memo {
    width: 152px;
  }
  .c-id {
    width: 144px;
  }
  .c-amt {
    width: 216px;
  }
  .c-date {
    width: 104px;
  }
  @container (max-width: 816px) {
    .c-memo {
      display: none;
    }
  }
  @container (max-width: 692px) {
    .c-date {
      display: none;
    }
  }
  @container (max-width: 588px) {
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
