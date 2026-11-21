<script lang="ts">
  import Sym from "./Sym.svelte";
  import { fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import Icon from "./Icon.svelte";
  import DelegateName from "./DelegateName.svelte";
  import { app, type TxEvent } from "../lib/state.svelte";
  import { formatArk, formatFiat, shortAddress } from "../lib/format";

  const SHOW_MS = 12000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function arm(e: TxEvent) {
    clearTimeout(timers.get(e.key));
    timers.set(e.key, setTimeout(() => close(e.key), SHOW_MS));
  }
  function pause(e: TxEvent) {
    clearTimeout(timers.get(e.key));
  }
  function close(key: string) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    app.dismissEvent(key);
  }

  // start a timer for every new card
  $effect(() => {
    for (const e of app.events) if (!timers.has(e.key)) arm(e);
  });

  function walletName(e: TxEvent) {
    return app.wallet(e.walletId)?.name ?? shortAddress(e.tx.sender, 6);
  }
  function partyName(addr?: string) {
    if (!addr) return "";
    const w = app.wallets.find((x) => x.address === addr);
    return w ? w.name : shortAddress(addr, 6);
  }
  function headline(e: TxEvent) {
    const a = e.row.amount;
    if (a > 0n) return `Received ${formatArk(a)}`;
    if (a < 0n) return `Sent ${formatArk(-a)}`;
    return e.row.label;
  }
  function fiat(e: TxEvent) {
    const a = e.row.amount < 0n ? -e.row.amount : e.row.amount;
    if (a === 0n) return "";
    const f = app.fiatValue(e.network, a);
    return f === null ? "" : formatFiat(f, app.settings.currency);
  }
  function open(e: TxEvent) {
    app.view = { name: "wallet", id: e.walletId };
    close(e.key);
  }
</script>

<div class="overlay">
  {#each app.events.slice(-4) as e (e.key)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="card ev {e.row.dir}"
      in:fly={{ x: 380, duration: 320, opacity: 0.2 }}
      out:fly={{ x: 380, duration: 220 }}
      animate:flip={{ duration: 220 }}
      onmouseenter={() => pause(e)}
      onmouseleave={() => arm(e)}
    >
      <div class="icon"><Icon name={e.row.icon} size={18} /></div>
      <div class="body">
        <div class="row" style="gap:6px">
          <span class="title num">{headline(e)}{#if e.row.amount !== 0n}<Sym network={e.network} />{/if}</span>
          {#if fiat(e)}<span class="small num">≈ <span class="usd">{fiat(e)}</span></span>{/if}
        </div>
        <div class="small muted ellipsis">
          <b class="wname">{walletName(e)}</b>
          {#if e.row.votes}
            ·
            {#each e.row.votes as v, i}{i > 0 ? " → " : ""}{v[0] === "+" ? "for " : "from "}<DelegateName network={e.network} publicKey={v.slice(1)} />{/each}
          {:else if e.row.counterparty}
            · {e.row.dir === "in" ? "from" : "to"} <span class="mono">{partyName(e.row.counterparty)}</span>
          {/if}
        </div>
        {#if e.tx.vendorField}<div class="memo small ellipsis">“{e.tx.vendorField}”</div>{/if}
        <div class="bar"><span style="animation-duration:{SHOW_MS}ms"></span></div>
      </div>
      <div class="actions">
        <button class="btn ghost icon" title="Dismiss" onclick={() => close(e.key)}><Icon name="x" size={13} /></button>
        <button class="btn small" onclick={() => open(e)}>View</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .overlay {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 380px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 90;
    pointer-events: none;
  }
  .ev {
    pointer-events: auto;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 10px 12px 14px;
    background: rgba(40, 40, 45, 0.96);
    backdrop-filter: blur(8px);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--accent);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
    border-radius: 12px;
  }
  .ev.in {
    border-left-color: var(--green);
  }
  .ev.out {
    border-left-color: var(--red);
  }
  .icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .ev.in .icon {
    background: var(--green-soft);
    color: var(--green);
  }
  .ev.out .icon {
    background: var(--red-soft);
    color: var(--red);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-weight: 650;
    font-size: 14.5px;
  }
  .ev.in .title {
    color: var(--green);
  }
  .ev.out .title {
    color: var(--red);
  }
  .wname {
    color: var(--text);
    font-weight: 600;
  }
  .memo {
    color: var(--muted);
    font-style: italic;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .actions .icon {
    width: 22px;
    height: 22px;
    background: none;
  }
  .bar {
    height: 2px;
    margin-top: 7px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: rgba(255, 255, 255, 0.25);
    animation: drain linear forwards;
  }
  .ev:hover .bar span {
    animation-play-state: paused;
  }
  @keyframes drain {
    from {
      width: 100%;
    }
    to {
      width: 0%;
    }
  }
</style>
