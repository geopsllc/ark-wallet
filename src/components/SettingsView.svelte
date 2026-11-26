<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { CURRENCIES } from "../lib/price";
  import { NETWORKS, type NetworkId } from "../lib/types";

  const ids = Object.keys(NETWORKS) as NetworkId[];

  let urls = $state<Record<NetworkId, string>>({
    mainnet: app.apiUrl("mainnet"),
    devnet: app.apiUrl("devnet"),
  });
  let status = $state<Record<string, { kind: "ok" | "error" | "busy"; text: string }>>({});

  async function test(id: NetworkId): Promise<boolean> {
    status[id] = { kind: "busy", text: "Testing…" };
    try {
      const r = await ark.probe(urls[id].trim());
      if (r.pubKeyHash !== NETWORKS[id].pubKeyHash) {
        status[id] = { kind: "error", text: `This node serves a different network (pubKeyHash ${r.pubKeyHash})` };
        return false;
      }
      status[id] = {
        kind: "ok",
        text: `Connected · height ${r.height.toLocaleString()}${r.version ? ` · Core ${r.version}` : ""}`,
      };
      return true;
    } catch (e: any) {
      status[id] = { kind: "error", text: String(e?.message ?? e) };
      return false;
    }
  }

  async function save(id: NetworkId) {
    if (await test(id)) {
      app.setApiUrl(id, urls[id]);
      app.toast("ok", `${NETWORKS[id].name} API saved`);
    }
  }

  function reset(id: NetworkId) {
    urls[id] = NETWORKS[id].defaultApi;
    app.setApiUrl(id, null);
    status[id] = { kind: "ok", text: "Using the official ARK API" };
  }

  function setRefresh(e: Event) {
    app.settings.refreshSeconds = Number((e.target as HTMLSelectElement).value);
    app.persist();
    app.restartTimer();
  }
</script>

<div class="settings stack">
  <h1>Settings</h1>

  <section class="card stack">
    <div class="row"><Icon name="globe" /><h2>Network API</h2></div>
    <p class="muted" style="margin:0">
      Wallet data comes from the official ARK API by default. You can point a network at your own or a third-party Core
      v3 node (e.g. <span class="mono">https://my-node.example.com/api</span>).
    </p>
    {#each ids as id}
      <div class="net">
        <div class="row">
          <h3>{NETWORKS[id].name}</h3>
          {#if app.settings.apiUrls[id]}<span class="badge warn">Custom</span>{:else}<span class="badge accent">Official</span>{/if}
        </div>
        <div class="row">
          <input bind:value={urls[id]} class="mono" spellcheck="false" />
          <button class="btn" onclick={() => test(id)}>Test</button>
          <button class="btn primary" onclick={() => save(id)}>Save</button>
          <button class="btn ghost" title="Reset to the official API" onclick={() => reset(id)}><Icon name="refresh" size={14} /></button>
        </div>
        {#if status[id]}
          <div class="small" class:green={status[id].kind === "ok"} class:red={status[id].kind === "error"} class:muted={status[id].kind === "busy"}>
            {status[id].text}
          </div>
        {/if}
      </div>
    {/each}
  </section>

  <section class="card stack">
    <div class="row"><Icon name="layers" /><h2>Transactions</h2></div>
    <div class="line">
      <div>
        <div>Default fee</div>
        <div class="muted small">Pre-selected in every transaction. Choosing Minimum or Average when sending also updates this.</div>
      </div>
      <div class="seg">
        <button class:on={app.settings.feeChoice === "min"} onclick={() => app.setFeeChoice("min")}>Minimum</button>
        <button class:on={app.settings.feeChoice === "avg"} onclick={() => app.setFeeChoice("avg")}>Average</button>
      </div>
    </div>
  </section>

  <section class="card stack">
    <div class="row"><Icon name="settings" /><h2>General</h2></div>
    <div class="line">
      <div>
        <div>Currency</div>
        <div class="muted small">Prices from CoinGecko</div>
      </div>
      <select value={app.settings.currency} onchange={(e) => app.setCurrency((e.target as HTMLSelectElement).value)} style="width:140px">
        {#each CURRENCIES as c}<option value={c}>{c.toUpperCase()}</option>{/each}
      </select>
    </div>
    <div class="line">
      <div>
        <div>Include delegate wallets in totals</div>
        <div class="muted small">
          Off by default: a delegate's balance is usually shared out to its voters, so it isn't really yours. Affects the
          portfolio total on the dashboard and in the sidebar.
        </div>
      </div>
      <button
        class="switch"
        role="switch"
        aria-checked={!!app.settings.includeDelegates}
        aria-label="Include delegate wallets in totals"
        onclick={() => app.setIncludeDelegates(!app.settings.includeDelegates)}
      ><span></span></button>
    </div>
    <div class="line">
      <div>
        <div>Full refresh every</div>
        <div class="muted small">
          New blocks are checked every 8 s and wallets update as soon as a transaction touches them; this is an extra
          safety refresh of everything.
          {#if app.height.mainnet}<br />Mainnet block <span class="num">{app.height.mainnet.toLocaleString()}</span>{/if}
        </div>
      </div>
      <select value={String(app.settings.refreshSeconds)} onchange={setRefresh} style="width:140px">
        <option value="30">30 seconds</option>
        <option value="60">1 minute</option>
        <option value="300">5 minutes</option>
      </select>
    </div>
  </section>

  <section class="card stack">
    <div class="row"><Icon name="shield" /><h2>Security</h2></div>
    <p class="muted" style="margin:0">
      ARK Wallet never stores passphrases. Your collection only holds public addresses. Passphrases are typed when you
      sign, used in memory to sign that one transaction, and then wiped. Transactions are signed locally and only the
      signed transaction is sent to the node.
    </p>
  </section>
</div>

<style>
  .settings {
    max-width: 760px;
    gap: 16px;
  }
  .net {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 6px;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .switch {
    flex-shrink: 0;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: 1px solid var(--border-strong);
    background: rgba(255, 255, 255, 0.08);
    padding: 0;
    position: relative;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .switch span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform 0.15s, background 0.15s;
  }
  .switch[aria-checked="true"] {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .switch[aria-checked="true"] span {
    transform: translateX(18px);
    background: var(--accent);
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
