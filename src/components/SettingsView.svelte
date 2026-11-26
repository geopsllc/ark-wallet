<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { ms } from "../lib/mainsail";
  import { CURRENCIES } from "../lib/price";
  import { NETWORKS, type NetworkId } from "../lib/types";
  import { evmAddressCheck, choiceLabel, coinOf, isOffered, parseChoice, payoutNetwork, PAYOUT_CHOICES } from "../lib/drain";

  const ids = Object.keys(NETWORKS) as NetworkId[];

  let urls = $state<Record<NetworkId, string>>({
    mainnet: app.apiUrl("mainnet"),
    testnet: app.apiUrl("testnet"),
  });
  // Mainsail nodes serve signed transactions and JSON-RPC on their own endpoints
  let txUrls = $state<Partial<Record<NetworkId, string>>>({ testnet: app.txApiUrl("testnet") });
  let rpcUrls = $state<Partial<Record<NetworkId, string>>>({ testnet: app.rpcUrl("testnet") });
  const isCustom = (id: NetworkId) => !!(app.settings.apiUrls[id] || app.settings.txApiUrls?.[id] || app.settings.rpcUrls?.[id]);
  let status = $state<Record<string, { kind: "ok" | "error" | "busy"; text: string }>>({});

  async function test(id: NetworkId): Promise<boolean> {
    status[id] = { kind: "busy", text: "Testing…" };
    try {
      if (NETWORKS[id].family === "mainsail") {
        const [r, chainId] = await Promise.all([ms.probe(urls[id].trim()), ms.chainId(rpcUrls[id]!.trim())]);
        if (chainId !== NETWORKS[id].chainId) {
          status[id] = { kind: "error", text: `The JSON-RPC endpoint serves a different chain (chain id ${chainId})` };
          return false;
        }
        if (r.symbol && r.symbol !== NETWORKS[id].symbol) {
          status[id] = { kind: "error", text: `This node serves a different network (${r.symbol})` };
          return false;
        }
        status[id] = { kind: "ok", text: `Connected · block ${r.height.toLocaleString()} · chain ${chainId}${r.version ? ` · Mainsail ${r.version}` : ""}` };
        return true;
      }
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
      if (NETWORKS[id].family === "mainsail") app.setMainsailUrls(id, txUrls[id] ?? null, rpcUrls[id] ?? null);
      app.setApiUrl(id, urls[id]);
      app.toast("ok", `${NETWORKS[id].name} API saved`);
    }
  }

  function reset(id: NetworkId) {
    urls[id] = NETWORKS[id].defaultApi;
    if (NETWORKS[id].family === "mainsail") {
      txUrls[id] = NETWORKS[id].defaultTxApi;
      rpcUrls[id] = NETWORKS[id].defaultRpc;
      app.setMainsailUrls(id, null, null);
    }
    app.setApiUrl(id, null);
    status[id] = { kind: "ok", text: NETWORKS[id].family === "mainsail" ? "Using the official Mainsail endpoints" : "Using the official ARK API" };
  }

  // ---- USDC/USDT payout address book (Exchange tab); coin and network are picked together ("usdc:polygon") ----
  let pName = $state("");
  let pChoice = $state<string>(PAYOUT_CHOICES[0].value);
  let pAddr = $state("");
  let pError = $state("");
  let pNote = $state("");
  let editing = $state<string | null>(null);
  let editName = $state("");
  let editChoice = $state<string>(PAYOUT_CHOICES[0].value);
  const sameEntry = (x: { coin: string; network: string; address: string }, coin: string, network: string, address: string) =>
    coinOf(x.coin) === coin && x.network === network && x.address.toLowerCase() === address.toLowerCase();

  async function addPayout() {
    pError = "";
    pNote = "";
    const name = pName.trim();
    const address = pAddr.trim();
    if (!name) return (pError = "Give the address a name");
    const check = await evmAddressCheck(address);
    if (check === "invalid") return (pError = "Not a valid 0x address (0x followed by 40 hex characters)");
    if (check === "bad-checksum") return (pError = "This address has a typo: its upper/lower-case checksum doesn't match");
    const { coin, network } = parseChoice(pChoice);
    if (app.payoutAddresses.some((p) => sameEntry(p, coin, network, address)))
      return (pError = `That address is already in the list for ${choiceLabel(coin, network)}`);
    app.addPayoutAddress(name, coin, network, address);
    if (check === "unchecked") pNote = "Saved. This address is all one case, so it has no checksum to verify: double-check it.";
    pName = "";
    pAddr = "";
  }

  function startEdit(id: string) {
    const p = app.payoutAddresses.find((x) => x.id === id);
    if (!p) return;
    pError = "";
    pNote = "";
    editing = id;
    editName = p.name;
    const cur = `${coinOf(p.coin)}:${payoutNetwork(p.network).id}`;
    editChoice = PAYOUT_CHOICES.some((c) => c.value === cur) ? cur : PAYOUT_CHOICES[0].value;
  }
  function saveEdit() {
    const p = app.payoutAddresses.find((x) => x.id === editing);
    if (!p) return (editing = null);
    const name = editName.trim();
    if (!name) return (pError = "Give the address a name");
    const { coin, network } = parseChoice(editChoice);
    if (app.payoutAddresses.some((x) => x.id !== p.id && sameEntry(x, coin, network, p.address)))
      return (pError = `That address is already in the list for ${choiceLabel(coin, network)}`);
    app.updatePayoutAddress(p.id, { name, coin, network });
    pError = "";
    editing = null;
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
      Wallet data comes from the official APIs by default. You can point a network at your own or a third-party node
      (e.g. <span class="mono">https://my-node.example.com/api</span>): a Core v3 node for Mainnet, a Mainsail node for
      the testnet.
    </p>
    {#each ids as id}
      <div class="net">
        <div class="row">
          <h3>{NETWORKS[id].name}</h3>
          {#if isCustom(id)}<span class="badge warn">Custom</span>{:else}<span class="badge accent">Official</span>{/if}
        </div>
        {#if NETWORKS[id].family === "mainsail"}
          <!-- label | address | actions: the three endpoints line up, the actions sit beside the first -->
          <div class="epgrid">
            <span class="faint small">REST API</span>
            <input bind:value={urls[id]} class="mono" spellcheck="false" />
            <div class="row">
              <button class="btn" onclick={() => test(id)}>Test</button>
              <button class="btn primary" onclick={() => save(id)}>Save</button>
              <button class="btn ghost" title="Reset to the official endpoints" onclick={() => reset(id)}><Icon name="refresh" size={14} /></button>
            </div>
            <span class="faint small">Transactions</span>
            <input bind:value={txUrls[id]} class="mono" spellcheck="false" />
            <span></span>
            <span class="faint small">JSON-RPC</span>
            <input bind:value={rpcUrls[id]} class="mono" spellcheck="false" />
            <span></span>
          </div>
        {:else}
          <div class="row">
            <input bind:value={urls[id]} class="mono" spellcheck="false" />
            <button class="btn" onclick={() => test(id)}>Test</button>
            <button class="btn primary" onclick={() => save(id)}>Save</button>
            <button class="btn ghost" title="Reset to the official API" onclick={() => reset(id)}><Icon name="refresh" size={14} /></button>
          </div>
        {/if}
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
    <div class="row"><Icon name="swap" /><h2>Payout addresses</h2></div>
    <p class="muted" style="margin:0">
      Where the Exchange tab sends USDC or USDT: each entry is an address for one coin on one network. Only add
      addresses you control there (a regular wallet, or a deposit address your exchange gives you for exactly that
      coin and network). The wallet refuses any order that doesn't pay out to the entry you pick.
    </p>
    {#if app.payoutAddresses.length}
      <div class="plist">
        {#each app.payoutAddresses as p (p.id)}
          <div class="prow" class:editing={editing === p.id}>
            {#if editing === p.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="pname-input" bind:value={editName} maxlength="40" autofocus
                onkeydown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") { editing = null; pError = ""; } }} />
              <select class="pnet-edit" bind:value={editChoice} title="Coin and network of this address">
                {#each PAYOUT_CHOICES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
              </select>
              <span class="mono small paddr-full">{p.address}</span>
              <button class="btn primary small psave" title="Save" aria-label="Save" onclick={saveEdit}><Icon name="check" size={13} /></button>
              <button class="btn ghost small" title="Cancel" aria-label="Cancel" onclick={() => { editing = null; pError = ""; }}><Icon name="x" size={13} /></button>
            {:else}
              <span class="pname">{p.name}</span>
              {#if isOffered(p.coin, p.network)}
                <span class="badge pnet">{choiceLabel(p.coin, p.network)}</span>
              {:else}
                <span class="badge pnet warn" title="No longer offered on the Exchange tab: edit it to pick another network, or remove it">{choiceLabel(p.coin, p.network)} · not offered</span>
              {/if}
              <span class="mono small paddr" title={p.address}>{p.address}</span>
              <button class="btn ghost small" title="Edit name, coin and network" onclick={() => startEdit(p.id)}><Icon name="edit" size={13} /></button>
              <button class="btn ghost small" title="Remove" onclick={() => app.removePayoutAddress(p.id)}><Icon name="trash" size={13} /></button>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="faint small">No payout addresses yet.</div>
    {/if}
    <div class="row padd">
      <input bind:value={pName} placeholder="Name (e.g. Ledger)" maxlength="40" spellcheck="false" autocomplete="off" style="width:170px" />
      <select bind:value={pChoice} style="width:175px" title="Coin and network">
        {#each PAYOUT_CHOICES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
      </select>
      <input bind:value={pAddr} class="mono" placeholder="0x… address" spellcheck="false" autocomplete="off" style="flex:1"
        onkeydown={(e) => e.key === "Enter" && addPayout()} />
      <button class="btn primary" onclick={addPayout}><Icon name="plus" size={13} /> Add</button>
    </div>
    {#if pError}<div class="small red">{pError}</div>{/if}
    {#if pNote}<div class="small warn-text">{pNote}</div>{/if}
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
    gap: 16px;
  }
  .epgrid {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px 10px;
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
  .plist {
    display: flex;
    flex-direction: column;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .pname {
    font-weight: 600;
    width: 160px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pname-input {
    width: 180px;
    flex-shrink: 0;
  }
  .pnet {
    flex-shrink: 0;
  }
  .pnet-edit {
    flex-shrink: 0;
    width: 175px;
  }
  .paddr {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* edit mode: the address is never cut off; the row wraps only when the window is too narrow for it */
  .prow.editing {
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .paddr-full {
    white-space: nowrap;
  }
  .psave {
    margin-left: auto;
  }
  .warn-text {
    color: var(--warn, #e0b050);
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
