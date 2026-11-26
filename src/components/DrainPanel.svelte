<script lang="ts">
  import Sym from "./Sym.svelte";
  import Icon from "./Icon.svelte";
  import Address from "./Address.svelte";
  import CopyButton from "./CopyButton.svelte";
  import ConfirmTx from "./ConfirmTx.svelte";
  import { app } from "../lib/state.svelte";
  import { ark, type NodeFeeConfig } from "../lib/ark";
  import { openExternal } from "../lib/backend";
  import { feeOptions } from "../lib/fees";
  import { formatArk, formatFiat, parseArk } from "../lib/format";
  import { drain, evmAddressCheck, checkOrder, choiceLabel, coinName, coinOf, isOffered, parseChoice, payoutLink, payoutNetwork, toCoins, tracking, PAYOUT_CHOICES, type Coin, type DrainOrder, type DrainQuote, type PayoutNetwork } from "../lib/drain";
  import type { DrainRecord, TxDraft, WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();

  const data = $derived(app.data[wallet.address]);
  const balance = $derived(BigInt(data?.balance ?? "0"));
  // payout address: an entry from your named address book (Settings; the last one used is pre-selected),
  // or a one-off address, coin and network typed in here. Entries on a network no longer offered are left out.
  const ONE_OFF = "one-off";
  const entries = $derived(app.payoutAddresses.filter((p) => isOffered(p.coin, p.network)));
  let payoutId = $state(app.settings.lastPayoutId ?? "");
  const oneOff = $derived(payoutId === ONE_OFF || entries.length === 0);
  const payoutEntry = $derived(oneOff ? undefined : (entries.find((p) => p.id === payoutId) ?? entries[0]));
  let ooAddr = $state("");
  let ooChoice = $state<string>(PAYOUT_CHOICES[0].value);
  let ooCheck = $state<{ addr: string; result: string }>({ addr: "", result: "" });
  $effect(() => {
    const a = ooAddr.trim();
    if (!a) return;
    let live = true;
    evmAddressCheck(a).then((result) => live && (ooCheck = { addr: a, result }));
    return () => (live = false);
  });
  // the one-off address once it passed the check (and only for the text that was checked)
  const ooState = $derived(ooCheck.addr === ooAddr.trim() && ooAddr.trim() ? ooCheck.result : "");
  const payout = $derived(oneOff ? (ooState === "ok" || ooState === "unchecked" ? ooAddr.trim() : "") : (payoutEntry?.address ?? ""));
  function pickPayout(id: string) {
    payoutId = id;
    if (id !== ONE_OFF) app.setLastPayout(id);
  }
  let confirmClear = $state(false);
  // the payout entry (or the one-off choice) decides the coin and network too
  const target = $derived(
    oneOff ? parseChoice(ooChoice) : { coin: coinOf(payoutEntry?.coin), network: payoutNetwork(payoutEntry?.network).id as PayoutNetwork },
  );
  const network = $derived(target.network);
  const coin = $derived(target.coin);
  let quotedPayout = $state("");
  let quotedNet = $state<PayoutNetwork>("polygon");
  let quotedCoin = $state<Coin>("usdc");
  let orderNet = $state<PayoutNetwork>("polygon");
  let orderCoin = $state<Coin>("usdc");

  let amount = $state("");
  let quotedFor = $state(""); // amount (whole ARK) the current quotes are for
  let quotes = $state<DrainQuote[]>([]);
  let quoteErrors = $state<{ service: string; message: string }[]>([]);
  let selected = $state(0);
  let busy = $state<"" | "quote" | "order">("");
  // mirrors the Worker's limits (one fresh quote per 10 s, per-service budgets) so the button says when it's ready
  let cooldown = $state(0);
  let cdTimer: ReturnType<typeof setInterval> | undefined;
  function startCooldown(seconds: number) {
    cooldown = Math.max(cooldown, Math.ceil(seconds));
    clearInterval(cdTimer);
    cdTimer = setInterval(() => {
      cooldown = Math.max(0, cooldown - 1);
      if (cooldown === 0) clearInterval(cdTimer);
    }, 1000);
  }
  $effect(() => () => clearInterval(cdTimer));
  let quotedAt = $state(0);
  let fromCache = $state(false);
  let error = $state("");

  let order = $state<DrainOrder | null>(null);
  let orderQuote = $state<DrainQuote | null>(null);
  let orderAmount = $state(0n);
  let problems = $state<string[]>([]);
  let recordId = $state("");
  let draft = $state<TxDraft | null>(null);
  let sentTx = $state("");

  let cfg = $state<NodeFeeConfig | null>(null);
  $effect(() => {
    ark.fees(app.apiUrl(wallet.network)).then((c) => (cfg = c)).catch(() => {});
  });
  const fee = $derived.by(() => {
    if (!cfg) return null;
    const o = feeOptions(cfg, { kind: "transfer", vendorField: "", hasSecondSignature: !!data?.secondPublicKey });
    return app.settings.feeChoice === "min" ? o.min : o.avg;
  });

  const parsed = $derived(parseArk(amount));
  const coins = $derived(parsed && parsed > 0n ? toCoins(parsed) : "");
  const stale = $derived(quotes.length > 0 && (coins !== quotedFor || network !== quotedNet || coin !== quotedCoin || payout !== quotedPayout));

  // USDC and USDT are ~1 USD, so compare with the market only when prices are in USD
  const market = $derived(app.price && app.settings.currency === "usd" && coins ? Number(coins) * app.price.price : null);

  const history = $derived(app.drains.filter((d) => d.walletId === wallet.id));

  function max() {
    if (fee === null) return;
    const m = balance - fee;
    amount = m > 0n ? toCoins(m) : "0";
  }

  async function getQuotes() {
    error = "";
    if (!coins) return (error = "Enter an amount greater than zero");
    if (fee !== null && parsed! + fee > balance) return (error = "That's more than the balance minus the fee");
    busy = "quote";
    quotes = [];
    quoteErrors = [];
    try {
      const net = network;
      const c = coin;
      const r = await drain.quote(coins, net, c);
      quotedNet = net;
      quotedCoin = c;
      quotedPayout = payout;
      quotes = r.quotes;
      quoteErrors = r.errors;
      quotedFor = r.amount;
      quotedAt = r.at ?? Date.now();
      fromCache = !!r.cached;
      selected = 0;
      if (!r.cached) startCooldown(10);
      if (!quotes.length) error = "No exchange offered a quote for this amount";
    } catch (e: any) {
      error = String(e?.message ?? e);
      if (e?.retryAfter) startCooldown(e.retryAfter);
    } finally {
      busy = "";
    }
  }

  async function createOrder() {
    const q = quotes[selected];
    if (!q || stale || !parsed || !payout) return;
    error = "";
    busy = "order";
    try {
      const { order: o } = await drain.order(quotedFor, quotedNet, quotedCoin, q, payout, wallet.address);
      orderNet = quotedNet;
      orderCoin = quotedCoin;
      order = o;
      orderQuote = q;
      orderAmount = parsed;
      problems = await checkOrder(o, quotedFor, q, payout, quotedCoin);
      const rec: DrainRecord = {
        id: crypto.randomUUID(),
        walletId: wallet.id,
        address: wallet.address,
        at: Date.now(),
        service: o.service,
        provider: o.provider,
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        depositAddress: o.depositAddress,
        amount: parsed.toString(),
        amountTo: o.amountTo ?? q.amountTo,
        payoutAddress: o.payoutAddress,
        networkTo: o.networkTo || q.networkTo,
        chain: quotedNet,
        coin: quotedCoin,
        status: "created",
      };
      recordId = rec.id;
      app.addDrain(rec);
    } catch (e: any) {
      error = String(e?.message ?? e);
      // the exchange answered with a refusal, so no order exists (unlike a timeout, where one might)
      if (/(createTransaction|new_trade) failed/.test(error))
        error += ". No order was created and nothing was sent. This is usually temporary on the exchange's side: try again in a minute, or pick another exchange.";
      if (e?.retryAfter) startCooldown(e.retryAfter);
    } finally {
      busy = "";
    }
  }

  function send() {
    if (!order || !orderQuote || problems.length) return;
    draft = {
      kind: "transfer",
      title: `Exchange to ${coinName(orderCoin)}`,
      summary: [
        ["Exchange", `${order.provider} via ${order.service}`],
        ["Order", order.orderId],
        ["Deposit address", order.depositAddress],
        ["Amount", `${formatArk(orderAmount, 8)} ARK`],
        ["You receive", `≈ ${order.amountTo ?? orderQuote.amountTo} ${coinName(orderCoin)} on ${payoutNetwork(orderNet).name} (${orderQuote.rateType})`],
        ["Payout address", order.payoutAddress],
      ],
      fields: { amount: orderAmount.toString(), recipientId: order.depositAddress },
      total: orderAmount,
    };
  }

  function sent(txId: string) {
    sentTx = txId;
    app.updateDrain(recordId, { txId, status: "sent" });
  }

  function reset() {
    order = null;
    orderQuote = null;
    problems = [];
    recordId = "";
    sentTx = "";
    quotes = [];
    quotedFor = "";
    amount = "";
  }

  function rate(q: DrainQuote) {
    return Number(q.amountTo) / Number(quotedFor);
  }
  function vsMarket(q: DrainQuote) {
    if (!app.price || app.settings.currency !== "usd") return "";
    const m = Number(quotedFor) * app.price.price;
    const pct = (Number(q.amountTo) / m - 1) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }
  function when(ms: number) {
    // date and time joined with a comma: WebKit's toLocaleString says "Nov 25 at 10:40 PM", which is wider
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  function open(url: string) {
    openExternal(url);
  }
</script>

<div class="stack drain">
  {#if !order}
    <div class="card stack">
      <div class="row">
        <div class="muted small">Swap ARK to USDC or USDT. You pick the exchange; nothing is sent until you confirm the transfer.</div>
        <span class="spacer"></span>
        <span class="muted small">Available: <span class="num">{formatArk(balance)}<Sym network={wallet.network} /></span></span>
      </div>
      <div class="xform">
        <label class="xlabel" for="xamount">Amount</label>
        <div class="xfield amt">
          <input id="xamount" bind:value={amount} class="num" placeholder="Amount of ARK" inputmode="decimal" spellcheck="false" autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && getQuotes()} />
          <button class="btn small inmax" onclick={max} disabled={fee === null} title="Balance minus the transfer fee">Max</button>
        </div>
        <div class="xextra">{#if market !== null}<span class="muted small">market ≈ <span class="usd">{formatFiat(market, "usd")}</span></span>{/if}</div>

        <label class="xlabel" for="xpayout">Receive at</label>
        <select id="xpayout" class="xfield" value={oneOff ? ONE_OFF : payoutEntry?.id} onchange={(e) => pickPayout((e.target as HTMLSelectElement).value)}>
          {#each entries as p (p.id)}<option value={p.id}>{p.name} · {choiceLabel(p.coin, p.network)}</option>{/each}
          <option value={ONE_OFF}>One-off address…</option>
        </select>
        <div class="xextra">
          {#if oneOff}
            <select bind:value={ooChoice} title="Coin and network">
              {#each PAYOUT_CHOICES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
            </select>
          {:else if payout}
            <button class="xlink small" title="{coinName(coin)} transfers to this address on {payoutNetwork(network).name}" onclick={() => open(payoutLink(payout, network))}>
              <Address address={payout} tail={6} /><Icon name="external" size={11} />
            </button>
          {/if}
        </div>

        {#if oneOff}
          <label class="xlabel" for="xaddr">Address</label>
          <div class="xwide row">
            <input id="xaddr" bind:value={ooAddr} class="mono oo" placeholder="0x… address" spellcheck="false" autocomplete="off" />
            {#if payout}
              <button class="xlink small" title="{coinName(coin)} transfers to this address on {payoutNetwork(network).name}" onclick={() => open(payoutLink(payout, network))}><Icon name="external" size={12} /></button>
            {/if}
          </div>
          <span></span>
          <div class="xwide stack" style="gap:4px">
            {#if ooState === "invalid"}
              <div class="small red">Not a valid 0x address (0x followed by 40 hex characters)</div>
            {:else if ooState === "bad-checksum"}
              <div class="small red">This address has a typo: its upper/lower-case checksum doesn't match</div>
            {:else if ooState === "unchecked"}
              <div class="small warn-text">This address is all one case, so it has no checksum to verify: double-check it.</div>
            {/if}
            <div class="faint small">
              Only use an address you control for {coinName(coin)} on {payoutNetwork(network).name}. Addresses you use often can be saved in
              <button class="inlink" onclick={() => (app.view = { name: "settings" })}>Settings</button>.
            </div>
          </div>
        {/if}
      </div>
      <div class="row">
        <span class="spacer"></span>
        <button class="btn primary" onclick={getQuotes} disabled={busy !== "" || cooldown > 0 || !payout}
          title="Quotes are rate limited to protect the exchange API keys">
          {#if busy === "quote"}<span class="spinner"></span>{:else}<Icon name="refresh" size={13} />{/if}
          {#if cooldown > 0}{quotes.length ? "Refresh" : "Get quotes"} in {cooldown}s{:else}{quotes.length ? "Refresh quotes" : "Get quotes"}{/if}
        </button>
      </div>
    </div>

    {#if error}<div class="notice error">{error}</div>{/if}

    {#if quotes.length}
      <div class="panel tablewrap">
        <table class="list">
          <thead>
            <tr><th class="c-pick"></th><th>Exchange</th><th class="c-via">Via</th><th class="c-rate">Rate</th><th class="right c-recv">You receive</th><th class="right c-per">Per ARK</th>{#if market !== null}<th class="right c-mkt">vs market</th>{/if}</tr>
          </thead>
          <tbody>
            {#each quotes as q, i (q.service + q.provider + q.rateType)}
              <tr class="q" class:sel={selected === i} onclick={() => (selected = i)}>
                <td class="c-pick"><span class="radio" class:on={selected === i}></span></td>
                <td>
                  <div class="row exch">
                    <span style="font-weight:600">{q.provider}</span>
                    {#if q.best}<span class="badge accent" title="Picked by default: the aggregator's own recommendation, otherwise the best payout">Best</span>{/if}
                  </div>
                </td>
                <td class="muted">{q.service}{#if q.kyc} · KYC {q.kyc}{/if}</td>
                <td class="muted">{q.rateType}</td>
                <td class="right num"><b>{Number(q.amountTo).toFixed(2)}</b> <span class="faint small">{coinName(quotedCoin)}</span></td>
                <td class="right num muted">{rate(q).toFixed(5)}</td>
                {#if market !== null}<td class="right num muted">{vsMarket(q)}</td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#each quoteErrors as e}<div class="faint small">{e.service}: {e.message}</div>{/each}
      <div class="faint small">
        Quoted {new Date(quotedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{fromCache ? " (cached, no new API calls)" : ""} ·
        floating rates move, so refresh before creating the order if these are getting old.
      </div>
      <div class="row">
        {#if stale}<span class="small warn-text">The amount or payout address changed: refresh the quotes first.</span>{/if}
        <span class="spacer"></span>
        <button class="btn primary" onclick={createOrder} disabled={busy !== "" || stale || !payout}>
          {#if busy === "order"}<span class="spinner"></span> Creating order…{:else}Create order with {quotes[selected]?.provider}{/if}
        </button>
      </div>
      <div class="faint small" style="text-align:right">Creating an order sends nothing. An order you don't fund simply expires.</div>
    {/if}
  {:else}
    {@const t = tracking(order)}
    <div class="card stack">
      <div class="row">
        <div class="oicon" class:bad={problems.length > 0} class:done={!!sentTx}><Icon name={sentTx ? "check" : "swap"} size={20} /></div>
        <div>
          <div style="font-weight:600">
            {#if sentTx}ARK sent — the exchange takes it from here{:else if problems.length}Order failed the checks — don't fund it{:else}Order created — nothing sent yet{/if}
          </div>
          <div class="muted small">{order.provider} via {order.service} · {orderQuote?.rateType}</div>
        </div>
      </div>

      <div class="kv">
        <span class="muted small">Order</span>
        <span class="mono small row" style="gap:6px">{order.orderId} <CopyButton text={order.orderId} /></span>
        {#if order.providerOrderId && order.providerOrderId !== order.orderId}
          <span class="muted small">{order.provider} order</span>
          <span class="mono small row" style="gap:6px">{order.providerOrderId} <CopyButton text={order.providerOrderId} /></span>
        {/if}
        <span class="muted small">Send</span>
        <span class="num">{formatArk(orderAmount, 8)}<Sym network={wallet.network} /></span>
        <span class="muted small">to deposit address</span>
        <span class="mono small row" style="gap:6px">{order.depositAddress} <CopyButton text={order.depositAddress} /></span>
        <span class="muted small">You receive</span>
        <span class="num">≈ {order.amountTo ?? orderQuote?.amountTo} {coinName(orderCoin)} <span class="faint small">on {payoutNetwork(orderNet).name}</span></span>
        <span class="muted small">Payout address</span>
        <span class="mono small">{order.payoutAddress}</span>
      </div>

      {#if problems.length}
        <div class="notice error">
          {#each problems as p}<div>{p}</div>{/each}
        </div>
      {/if}

      <div class="links">
        {#if t}
          <button class="btn" onclick={() => open(t.url)}><Icon name="external" size={13} /> Status on {t.label}</button>
          {#if t.note}<span class="faint small">{t.note}</span>{/if}
        {/if}
        {#if sentTx}
          <button class="btn" onclick={() => open(app.explorerTx(wallet.network, sentTx))}><Icon name="external" size={13} /> ARK transfer</button>
        {/if}
        <button class="btn" onclick={() => open(payoutLink(order!.payoutAddress, orderNet))}><Icon name="external" size={13} /> {coinName(orderCoin)} arrivals</button>
      </div>

      <div class="row">
        <span class="spacer"></span>
        {#if sentTx}
          <button class="btn" onclick={reset}>New exchange</button>
        {:else}
          <button class="btn ghost" onclick={reset}>Discard order</button>
          <button class="btn primary" disabled={problems.length > 0} onclick={send}><Icon name="send" size={14} /> Send {formatArk(orderAmount, 8)}<Sym network={wallet.network} /></button>
        {/if}
      </div>
    </div>
  {/if}

  {#if history.length}
    <div class="row" style="margin-top:4px">
      <span class="muted small">Previous exchanges</span>
      <span class="spacer"></span>
      {#if confirmClear}
        <span class="small muted">Clear this wallet's exchange history? Orders aren't affected.</span>
        <button class="btn ghost small" onclick={() => (confirmClear = false)}>Cancel</button>
        <button class="btn small danger" onclick={() => { app.clearDrains(wallet.id); confirmClear = false; }}>Clear</button>
      {:else}
        <button class="btn ghost small" onclick={() => (confirmClear = true)}><Icon name="trash" size={12} /> Clear history</button>
      {/if}
    </div>
    <div class="panel tablewrap history">
      <table class="list">
        <thead><tr><th class="h-date">Date</th><th>Exchange</th><th class="right h-amt">Amount</th><th class="right h-usdc">Received ≈</th><th class="h-status">Status</th><th class="right h-links">Links</th></tr></thead>
        <tbody>
          {#each history as h (h.id)}
            {@const t = tracking(h)}
            <tr>
              <td class="muted small">{when(h.at)}</td>
              <td title="via {h.service} · order {h.orderId}">{h.provider} <span class="faint small">· {payoutNetwork(h.chain).name}</span></td>
              <td class="right num">{formatArk(h.amount, 2, 2)}<Sym network={wallet.network} /></td>
              <td class="right num">{Number(h.amountTo).toFixed(2)} <span class="faint small">{coinName(h.coin)}</span></td>
              <td>{#if h.status === "sent"}<span class="badge green">Sent</span>{:else}<span class="badge">Not funded</span>{/if}</td>
              <td class="right">
                <span class="hlinks">
                  {#if t}<button class="xlink" title={t.note ? `${t.label}: ${t.note}` : `Order page on ${t.label}`} onclick={() => open(t.url)}>Order<Icon name="external" size={11} /></button>{/if}
                  {#if h.txId}<button class="xlink" title="The ARK transfer in the explorer" onclick={() => open(app.explorerTx(wallet.network, h.txId!))}>ARK<Icon name="external" size={11} /></button>{/if}
                  <button class="xlink" title="{coinName(h.coin)} arrivals on {payoutNetwork(h.chain).name}" onclick={() => open(payoutLink(h.payoutAddress, h.chain))}>{coinName(h.coin)}<Icon name="external" size={11} /></button>
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if draft}
  <ConfirmTx {wallet} {draft} onclose={() => (draft = null)} ondone={sent} />
{/if}

<style>
  /* label | field (amount and payout picker share one width) | extras */
  .xform {
    display: grid;
    grid-template-columns: auto minmax(340px, max-content) 1fr;
    column-gap: 14px;
    row-gap: 12px;
    align-items: center;
  }
  .xlabel {
    color: var(--muted);
    font-size: 13px;
  }
  .xfield {
    width: 100%;
  }
  select.xfield {
    min-width: 0;
  }
  .xextra {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .xextra select {
    width: 175px;
    flex: none;
  }
  .xwide {
    grid-column: 2 / 4;
    gap: 8px;
  }
  .xwide .oo {
    flex: 1;
    min-width: 0;
  }
  .amt {
    position: relative;
  }
  .amt input {
    width: 100%;
    padding-right: 64px;
  }
  .inmax {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    height: 24px;
    padding: 0 9px;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
    border-color: rgba(115, 191, 255, 0.35);
  }
  .inmax:hover:not(:disabled) {
    background: rgba(115, 191, 255, 0.22);
    border-color: var(--accent);
  }
  .inlink {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .inlink:hover {
    text-decoration: underline;
  }
  .tablewrap {
    overflow: hidden;
  }
  tr.q {
    cursor: pointer;
  }
  tr.q:hover td {
    background: rgba(255, 255, 255, 0.03);
  }
  tr.sel td {
    background: rgba(115, 191, 255, 0.07);
  }
  /* the table has fixed column widths: give the radio room (it was ellipsized) and let Exchange take the rest */
  .c-pick {
    width: 44px;
    padding-right: 0 !important;
    text-overflow: clip !important;
  }
  .c-via {
    width: 130px;
  }
  .c-rate {
    width: 100px;
  }
  .c-recv {
    width: 150px;
  }
  .c-per {
    width: 100px;
  }
  .c-mkt {
    width: 110px;
  }
  .exch {
    gap: 6px;
    flex-wrap: nowrap;
  }
  .exch :global(.badge) {
    flex-shrink: 0;
  }
  .radio {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
    vertical-align: middle;
  }
  .radio.on {
    border-color: var(--accent);
    background: radial-gradient(var(--accent) 0 45%, transparent 50%);
  }
  .warn-text {
    color: var(--warn, #e0b050);
  }
  .oicon {
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
  .oicon.bad {
    background: rgba(255, 90, 90, 0.12);
    color: var(--red, #ff6b6b);
  }
  .oicon.done {
    background: rgba(80, 200, 120, 0.12);
    color: var(--green, #5ccf8a);
  }
  .kv {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 8px 12px;
    align-items: center;
    word-break: break-all;
  }
  .h-date {
    width: 130px;
  }
  .h-amt {
    width: 103px;
  }
  .h-usdc {
    width: 133px;
  }
  .h-status {
    width: 103px;
  }
  .h-links {
    width: 167px;
  }
  /* one line per exchange: a little less side padding than other tables */
  .history :global(th),
  .history :global(td) {
    padding-left: 10px;
    padding-right: 10px;
  }
  .hlinks {
    display: inline-flex;
    gap: 7px;
    white-space: nowrap;
    font-size: 12px;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
</style>
