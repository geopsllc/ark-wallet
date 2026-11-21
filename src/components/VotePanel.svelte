<script lang="ts">
  import ConfirmTx from "./ConfirmTx.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { openExternal } from "../lib/backend";
  import { formatArk, shortAddress } from "../lib/format";
  import { NETWORKS, type Delegate, type TxDraft, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();

  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);
  const votedKey = $derived(data?.vote ?? null);

  let current = $state<Delegate | null>(null);
  let list = $state<Delegate[]>([]);
  let page = $state(1);
  let pageCount = $state(1);
  let search = $state("");
  let loading = $state(false);
  let error = $state("");
  let draft = $state<TxDraft | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const key = votedKey;
    current = null;
    if (key) ark.delegate(app.apiUrl(wallet.network), key).then((d) => (current = d)).catch(() => {});
  });

  async function load() {
    loading = true;
    error = "";
    try {
      const r = await ark.delegates(app.apiUrl(wallet.network), page, search);
      list = r.data;
      pageCount = r.pageCount;
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void page;
    void wallet.network;
    load();
  });

  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (page !== 1) page = 1;
      else load();
    }, 300);
  }

  const balanceText = $derived(`${formatArk(data?.balance ?? "0")} ${net.token}`);

  function vote(d: Delegate) {
    const switching = votedKey && votedKey !== d.publicKey;
    const votes = switching ? [`-${votedKey}`, `+${d.publicKey}`] : [`+${d.publicKey}`];
    draft = {
      kind: "vote",
      title: switching ? "Switch vote" : "Vote",
      summary: switching
        ? [
            ["Unvote", current ? `${current.username}` : shortAddress(votedKey!, 8)],
            ["Vote for", `${d.username} (rank ${d.rank})`],
            ["Voting weight", balanceText],
          ]
        : [
            ["Vote for", `${d.username} (rank ${d.rank})`],
            ["Voting weight", balanceText],
          ],
      fields: { votes },
      total: 0n,
    };
  }

  function unvote() {
    if (!votedKey) return;
    draft = {
      kind: "vote",
      title: "Unvote",
      summary: [["Unvote", current ? current.username : shortAddress(votedKey, 8)]],
      fields: { votes: [`-${votedKey}`] },
      total: 0n,
    };
  }

  function pct(d: Delegate) {
    return d.approval !== undefined ? `${d.approval.toFixed(2)}%` : "";
  }
</script>

<div class="stack">
  <div class="current card">
    {#if votedKey}
      <div class="row">
        <div class="vicon"><Icon name="vote" size={20} /></div>
        <div style="flex:1;min-width:0">
          <div class="muted small">Currently voting for</div>
          {#if current}
            <div class="row" style="gap:10px">
              <span class="dname">{current.username}</span>
              {#if current.isResigned}<span class="badge red">Resigned</span>
              {:else if current.rank <= 51}<span class="badge green">Active · #{current.rank}</span>
              {:else}<span class="badge warn">Standby · #{current.rank}</span>{/if}
            </div>
            <div class="faint small mono">{current.address}</div>
          {:else}
            <div class="mono small">{votedKey}</div>
          {/if}
        </div>
        {#if current}
          <button class="btn ghost small" onclick={() => openExternal(app.explorerAddress(wallet.network, current!.address))}>
            <Icon name="external" size={13} />
          </button>
        {/if}
        <button class="btn danger" onclick={unvote}>Unvote</button>
      </div>
      {#if current && (current.isResigned || current.rank > 51)}
        <div class="notice warn" style="margin-top:12px">
          This delegate is {current.isResigned ? "resigned" : "not in the active 51"} and is not forging. Consider switching your vote.
        </div>
      {/if}
    {:else}
      <div class="row">
        <div class="vicon off"><Icon name="vote" size={20} /></div>
        <div>
          <div style="font-weight:600">Not voting</div>
          <div class="muted small">Pick a delegate below. Voting is free of risk: your {net.token} never leaves your wallet.</div>
        </div>
      </div>
    {/if}
  </div>

  <div class="row">
    <div class="search">
      <Icon name="search" size={14} />
      <input bind:value={search} oninput={onSearch} placeholder="Search delegates" spellcheck="false" />
    </div>
    <span class="spacer"></span>
    {#if loading}<span class="spinner"></span>{/if}
    <button class="btn small" disabled={page <= 1} onclick={() => page--}>Prev</button>
    <span class="muted small num">Page {page} / {pageCount}</span>
    <button class="btn small" disabled={page >= pageCount} onclick={() => page++}>Next</button>
  </div>

  {#if error}<div class="notice error">{error}</div>{/if}

  <div class="panel tablewrap">
    <table class="list">
      <thead>
        <tr><th style="width:56px">Rank</th><th>Delegate</th><th class="right">Votes</th><th class="right">Approval</th><th class="right" style="width:130px"></th></tr>
      </thead>
      <tbody>
        {#each list as d (d.publicKey)}
          <tr class:mine={d.publicKey === votedKey}>
            <td class="num" class:faint={d.rank > 51}>{d.rank}</td>
            <td>
              <div class="row">
                <span style="font-weight:500">{d.username}</span>
                {#if d.isResigned}<span class="badge red">Resigned</span>{/if}
                {#if d.publicKey === votedKey}<span class="badge accent">Your vote</span>{/if}
              </div>
              <div class="faint small mono">{shortAddress(d.address, 8)}</div>
            </td>
            <td class="right num">{formatArk(d.votes, 0, 0)}</td>
            <td class="right num muted">{pct(d)}</td>
            <td class="right">
              {#if d.publicKey === votedKey}
                <button class="btn small danger" onclick={unvote}>Unvote</button>
              {:else if votedKey}
                <button class="btn small" disabled={d.isResigned} onclick={() => vote(d)}><Icon name="swap" size={13} /> Switch</button>
              {:else}
                <button class="btn small primary" disabled={d.isResigned} onclick={() => vote(d)}>Vote</button>
              {/if}
            </td>
          </tr>
        {:else}
          {#if !loading}<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">No delegates found</td></tr>{/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

{#if draft}
  <ConfirmTx {wallet} {draft} onclose={() => (draft = null)} />
{/if}

<style>
  .current {
    padding: 16px 18px;
  }
  .vicon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-right: 6px;
  }
  .vicon.off {
    background: rgba(255, 255, 255, 0.05);
    color: var(--faint);
  }
  .dname {
    font-size: 16px;
    font-weight: 600;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    width: 280px;
  }
  .search :global(svg) {
    position: absolute;
    left: 10px;
    color: var(--faint);
  }
  .search input {
    padding-left: 32px;
  }
  .tablewrap {
    overflow: hidden;
  }
  tr.mine td {
    background: rgba(115, 191, 255, 0.05);
  }
</style>
