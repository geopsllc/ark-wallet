<script lang="ts">
  import Icon from "./Icon.svelte";
  import DelegateName from "./DelegateName.svelte";
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { openExternal } from "../lib/backend";
  import { formatArk, formatDate, shortAddress, timeAgo } from "../lib/format";
  import { NETWORKS, type ApiTransaction, type WalletEntry } from "../lib/types";

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
    const fetchPage = () => ark.transactions(app.apiUrl(wallet.network), wallet.address, page, filter);
    try {
      let r;
      try {
        r = await fetchPage();
      } catch (e: any) {
        // public nodes hiccup now and then (5xx / timeouts): retry once before showing an error
        if (e?.status && e.status < 500) throw e;
        await new Promise((res) => setTimeout(res, 1200));
        r = await fetchPage();
      }
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

  interface Row {
    label: string;
    icon: string;
    dir: "in" | "out" | "self" | "other";
    amount: bigint; // signed, excluding fee
    counterparty?: string;
    votes?: string[];
  }

  function describe(t: ApiTransaction): Row {
    const me = wallet.address;
    const out = t.sender === me;
    const amt = BigInt(t.amount ?? "0");
    if (t.typeGroup === 1) {
      switch (t.type) {
        case 0: {
          if (out && t.recipient === me) return { label: "Transfer to self", icon: "swap", dir: "self", amount: 0n, counterparty: me };
          return out
            ? { label: "Sent", icon: "send", dir: "out", amount: -amt, counterparty: t.recipient }
            : { label: "Received", icon: "receive", dir: "in", amount: amt, counterparty: t.sender };
        }
        case 6: {
          const payments: { amount: string; recipientId: string }[] = t.asset?.payments ?? [];
          if (out) {
            const sum = payments.reduce((s, p) => s + BigInt(p.amount), 0n);
            const toSelf = payments.filter((p) => p.recipientId === me).reduce((s, p) => s + BigInt(p.amount), 0n);
            return { label: `Multipayment (${payments.length})`, icon: "users", dir: "out", amount: -(sum - toSelf) };
          }
          const mine = payments.filter((p) => p.recipientId === me).reduce((s, p) => s + BigInt(p.amount), 0n);
          return { label: "Multipayment received", icon: "receive", dir: "in", amount: mine, counterparty: t.sender };
        }
        case 3: {
          const votes: string[] = t.asset?.votes ?? [];
          const label = votes.length === 2 ? "Switch vote" : votes[0]?.startsWith("+") ? "Vote" : "Unvote";
          return { label, icon: "vote", dir: "other", amount: 0n, votes };
        }
        case 1:
          return { label: "Second passphrase", icon: "key", dir: "other", amount: 0n };
        case 2:
          return { label: `Delegate registration: ${t.asset?.delegate?.username ?? ""}`, icon: "star", dir: "other", amount: 0n };
        case 7:
          return { label: "Delegate resignation", icon: "x", dir: "other", amount: 0n };
        case 4:
          return { label: "Multisignature", icon: "users", dir: "other", amount: 0n };
        case 5:
          return { label: "IPFS", icon: "layers", dir: "other", amount: 0n };
        case 8:
        case 9:
        case 10:
          return { label: ["HTLC lock", "HTLC claim", "HTLC refund"][t.type - 8], icon: "lock", dir: out ? "out" : "in", amount: out ? -amt : amt };
      }
    }
    return { label: `Type ${t.typeGroup}/${t.type}`, icon: "layers", dir: "other", amount: out ? -amt : amt };
  }

  function partyName(addr?: string) {
    if (!addr) return "";
    const w = app.wallets.find((x) => x.address === addr);
    return w ? w.name : shortAddress(addr, 7);
  }
</script>

<div class="stack">
  <div class="row">
    <div class="seg">
      <button class:on={filter === "all"} onclick={() => setFilter("all")}>All</button>
      <button class:on={filter === "received"} onclick={() => setFilter("received")}>Received</button>
      <button class:on={filter === "sent"} onclick={() => setFilter("sent")}>Sent</button>
    </div>
    <span class="faint small num">{total.toLocaleString()} transactions</span>
    <span class="spacer"></span>
    {#if loading}<span class="spinner"></span>{/if}
    <button class="btn small" disabled={page <= 1} onclick={() => page--}>Prev</button>
    <span class="muted small num">Page {page} / {pageCount.toLocaleString()}</span>
    <button class="btn small" disabled={page >= pageCount} onclick={() => page++}>Next</button>
  </div>

  {#if error}
    <div class="notice error row">
      <span>Could not load transactions: {error}</span>
      <span class="spacer"></span>
      <button class="btn small" onclick={load}><Icon name="refresh" size={13} /> Retry</button>
    </div>
  {/if}

  <div class="panel" style="overflow:hidden">
    <table class="list">
      <thead>
        <tr>
          <th style="width:36%">Transaction</th>
          <th>Memo</th>
          <th class="right">Amount</th>
          <th class="right" style="width:150px">Date</th>
        </tr>
      </thead>
      <tbody>
        {#each txs as t (t.id)}
          {@const r = describe(t)}
          <tr class="clickable" onclick={() => openExternal(app.explorerTx(wallet.network, t.id))} title="Open in explorer">
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
                      {#each r.votes as v, i}
                        {i > 0 ? " → " : ""}{v[0] === "+" ? "for " : "from "}<DelegateName network={wallet.network} publicKey={v.slice(1)} />
                      {/each}
                    {:else if r.counterparty}
                      {r.dir === "in" ? "from" : "to"} <span class="mono">{partyName(r.counterparty)}</span>
                    {:else}
                      <span class="mono">{shortAddress(t.id, 8)}</span>
                    {/if}
                  </div>
                </div>
              </div>
            </td>
            <td class="memo muted ellipsis" title={t.vendorField ?? ""}>{t.vendorField ?? ""}</td>
            <td class="right num">
              {#if r.amount !== 0n}
                <div class:green={r.amount > 0n} class:red={r.amount < 0n} style="font-weight:500">
                  {r.amount > 0n ? "+" : "−"}{formatArk(r.amount < 0n ? -r.amount : r.amount)} <span class="faint small">{net.token}</span>
                </div>
              {/if}
              <div class="faint small" title={t.sender === wallet.address ? "Fee you paid" : "Fee paid by the sender"}>
                fee {formatArk(t.fee, 8, 0)}{t.sender === wallet.address ? "" : " (sender)"}
              </div>
            </td>
            <td class="right">
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
            <tr><td colspan="4" class="muted" style="text-align:center;padding:40px">No transactions yet</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .clickable {
    cursor: pointer;
  }
  .memo {
    max-width: 220px;
    font-size: 12.5px;
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
