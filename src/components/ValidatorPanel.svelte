<script lang="ts">
  // Mainsail: become a validator (BLS consensus key + 250 locked), manage it, and register a username.
  // The validator passphrase (BIP39 mnemonic of the BLS key) lives only in this component while the
  // screen is open: it is shown for backup, used to sign, and never saved.
  import Sym from "./Sym.svelte";
  import ConfirmTx from "./ConfirmTx.svelte";
  import Icon from "./Icon.svelte";
  import MnemonicSetup from "./MnemonicSetup.svelte";
  import SecretInput from "./SecretInput.svelte";
  import CopyButton from "./CopyButton.svelte";
  import { app } from "../lib/state.svelte";
  import { get } from "../lib/ark";
  import { backend, copyText, openExternal, shieldScreen } from "../lib/backend";
  import { gasFee, ms, VALIDATOR_GAS, VALIDATOR_LOCK } from "../lib/mainsail";
  import { formatArk, shortAddress } from "../lib/format";
  import { NETWORKS, type TxDraft, type WalletEntry } from "../lib/types";

  let { wallet }: { wallet: WalletEntry } = $props();
  const net = $derived(NETWORKS[wallet.network]);
  const data = $derived(app.data[wallet.address]);
  const v = $derived(data?.delegate ?? null);
  const balance = $derived(BigInt(data?.balance ?? "0"));

  let draft = $state<TxDraft | null>(null);
  let lock = $state<bigint>(VALIDATOR_LOCK);
  let minFee = $state<bigint>(0n);
  $effect(() => {
    ms.gas(app.apiUrl(wallet.network))
      .then((g) => {
        lock = g.validatorLock;
        minFee = gasFee(VALIDATOR_GAS, g.avgPrice);
      })
      .catch(() => {});
  });

  // ---------- validator key ----------
  /** "new": generating a fresh passphrase; "enter": typing an existing one */
  let keyMode = $state<"" | "new" | "enter">("");
  let keyPhrase = $state("");
  let typed = $state("");
  let blsKey = $state("");
  let keyError = $state("");
  /** what the key is for: registering, or replacing the key of an existing validator */
  let purpose = $state<"register" | "update">("register");

  // keep the window out of screen capture while a validator passphrase is held
  $effect(() => {
    if (keyPhrase || typed) return shieldScreen();
  });
  // forget the passphrase when leaving the tab
  $effect(() => () => {
    keyPhrase = "";
    typed = "";
  });

  async function useKey(phrase: string) {
    keyError = "";
    blsKey = "";
    try {
      blsKey = await backend.msValidatorPublicKey(phrase);
      keyPhrase = phrase;
      keyMode = "";
      typed = "";
    } catch (e: any) {
      keyError = String(e?.message ?? e);
    }
  }

  function forgetKey() {
    keyPhrase = "";
    typed = "";
    blsKey = "";
    keyMode = "";
    keyError = "";
  }

  function start(p: "register" | "update", mode: "new" | "enter") {
    forgetKey();
    purpose = p;
    keyMode = mode;
  }

  const enough = $derived(balance >= lock + minFee);

  function register() {
    draft = {
      kind: "validatorRegistration",
      title: "Register validator",
      summary: [
        ["Locked", `${formatArk(lock, 8, 0)} ${net.token}`],
        ["Validator key", shortAddress(blsKey, 10)],
        ["Note", "To produce blocks, run a Mainsail node with this validator passphrase"],
      ],
      fields: {},
      call: { kind: "validatorRegistration", amount: lock.toString() },
      total: lock,
    };
  }

  function update() {
    draft = {
      kind: "validatorUpdate",
      title: "Change validator key",
      summary: [
        ["New validator key", shortAddress(blsKey, 10)],
        ["Note", "Switch your node to the new validator passphrase once this is confirmed"],
      ],
      fields: {},
      call: { kind: "validatorUpdate" },
      total: 0n,
    };
  }

  function resign() {
    draft = {
      kind: "validatorResignation",
      title: "Resign validator",
      summary: [
        ["Validator", v?.username || shortAddress(wallet.address, 8)],
        ["Effect", "The validator leaves the validator set and stops producing blocks"],
      ],
      fields: {},
      call: { kind: "validatorResignation" },
      total: 0n,
    };
  }

  // ---------- username ----------
  let username = $state("");
  let nameStatus = $state<"" | "checking" | "taken" | "free" | "invalid">("");
  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  const validName = (u: string) => /^[a-z0-9_]{1,20}$/.test(u) && !u.startsWith("_") && !u.endsWith("_") && !u.includes("__");

  function onName() {
    clearTimeout(nameTimer);
    const u = username.trim();
    if (!u) return (nameStatus = "");
    if (!validName(u)) return (nameStatus = "invalid");
    nameStatus = "checking";
    nameTimer = setTimeout(async () => {
      try {
        const body = await get(app.apiUrl(wallet.network), `/wallets?attributes.username=${encodeURIComponent(u)}&limit=1`);
        if (username.trim() === u) nameStatus = (body.meta?.totalCount ?? body.data?.length ?? 0) > 0 ? "taken" : "free";
      } catch {
        if (username.trim() === u) nameStatus = "";
      }
    }, 350);
  }

  function registerName() {
    const u = username.trim();
    draft = {
      kind: "usernameRegistration",
      title: data?.username ? "Change username" : "Register username",
      summary: [["Username", u]],
      fields: { username: u },
      call: { kind: "usernameRegistration", username: u },
      total: 0n,
    };
  }

  function resignName() {
    draft = {
      kind: "usernameResignation",
      title: "Resign username",
      summary: [["Username", data?.username ?? ""]],
      fields: {},
      call: { kind: "usernameResignation" },
      total: 0n,
    };
  }

  /** Accepted by the network: the passphrase is no longer needed (the result screen stays open) */
  function sent() {
    forgetKey();
    username = "";
    nameStatus = "";
  }
</script>

{#snippet keyPicker()}
  {#if keyMode === "new"}
    <p class="muted small" style="margin:0">
      This is the passphrase of the validator's consensus (BLS) key. It is separate from your wallet passphrase: your
      node needs it, so it is not saved here. Write it down.
    </p>
    <MnemonicSetup copyable words={24} confirmLabel="Use this key" oncancel={() => (keyMode = "")} ondone={useKey} />
  {:else if keyMode === "enter"}
    <label class="field">
      Validator passphrase
      <SecretInput bind:value={typed} placeholder="The BIP39 passphrase your node uses (not your wallet passphrase)" autofocus />
    </label>
    <div class="row">
      <span class="spacer"></span>
      <button class="btn" onclick={() => (keyMode = "")}>Cancel</button>
      <button class="btn primary" disabled={!typed.trim()} onclick={() => useKey(typed.trim())}>Use this key</button>
    </div>
  {/if}
  {#if keyError}<div class="notice error">{keyError}</div>{/if}
  {#if blsKey}
    <div class="key fade">
      <div class="row"><span class="muted small">Validator public key (BLS)</span><span class="spacer"></span><CopyButton text={blsKey} /></div>
      <div class="mono small brk">{blsKey}</div>
      <div class="row">
        <span class="faint small">Your node signs with the validator passphrase you wrote down; it is not shown again.</span>
        <span class="spacer"></span>
        <button class="btn small ghost" onclick={forgetKey}>Start over</button>
      </div>
    </div>
  {/if}
{/snippet}

<div class="grid">
  <section class="card stack">
    <div class="row"><Icon name="star" /><h2>Validator</h2></div>
    {#if v && !v.resigned}
      <div class="row">
        <span style="font-size:16px;font-weight:600">{v.username || shortAddress(wallet.address, 8)}</span>
        {#if v.rank && v.rank <= net.activeProducers}<span class="badge green">Active · #{v.rank}</span>
        {:else if v.rank}<span class="badge warn">Standby · #{v.rank}</span>
        {:else}<span class="badge">Not ranked</span>{/if}
      </div>
      {#if v.voteBalance}
        <div class="muted small">Vote weight: <span class="num">{formatArk(v.voteBalance, 0, 0)}<Sym network={wallet.network} /></span></div>
      {/if}
      {#if v.blsPublicKey}
        <div class="faint small">Validator key: <span class="mono brk">{v.blsPublicKey}</span></div>
      {:else}
        <div class="notice warn">
          This validator has no consensus (BLS) key on record, so it cannot produce blocks. Register a key to start
          validating.
        </div>
      {/if}

      {#if keyMode || blsKey}
        {@render keyPicker()}
        {#if blsKey && purpose === "update"}
          <div class="row"><span class="spacer"></span><button class="btn primary" onclick={update}>{v.blsPublicKey ? "Change validator key" : "Register validator key"}</button></div>
        {/if}
      {:else}
        <div class="row" style="flex-wrap:wrap">
          <button class="btn" onclick={() => start("update", "new")}>{v.blsPublicKey ? "New validator key" : "Generate validator key"}</button>
          <button class="btn" onclick={() => start("update", "enter")}>Use an existing key</button>
          <span class="spacer"></span>
          <button class="btn danger" onclick={resign}>Resign validator</button>
        </div>
      {/if}
    {:else if v?.resigned}
      <div class="row">
        <span style="font-size:16px;font-weight:600">{v.username || shortAddress(wallet.address, 8)}</span>
        <span class="badge red">Resigned</span>
      </div>
      <p class="muted small" style="margin:0">This validator has resigned and no longer produces blocks.</p>
    {:else}
      <p class="muted" style="margin:0">
        Register this wallet as a {net.name} validator. Registration locks
        <span class="num">{formatArk(lock, 8, 0)}<Sym network={wallet.network} /></span> and needs a validator key: a
        separate passphrase that your Mainsail node uses to sign blocks.
      </p>
      {#if !enough && data}
        <div class="notice warn row" style="flex-wrap:wrap">
          <span>You need at least {formatArk(lock + minFee, 8, 0)}<Sym network={wallet.network} /> (lock plus fee). This wallet holds {formatArk(balance, 8, 0)}<Sym network={wallet.network} />.</span>
          {#if net.faucet}
            <button class="btn small" onclick={async () => { await copyText(wallet.address); openExternal(net.faucet!); app.toast("info", `Address copied: paste it on the faucet page to get test ${net.token}`); }}>
              <Icon name="external" size={13} /> Get test {net.token}
            </button>
          {/if}
        </div>
      {/if}
      {#if keyMode || blsKey}
        {@render keyPicker()}
        {#if blsKey}
          <div class="row"><span class="spacer"></span><button class="btn primary" disabled={!enough} onclick={register}>Register validator</button></div>
        {/if}
      {:else}
        <div class="row" style="flex-wrap:wrap">
          <button class="btn primary" disabled={!data} onclick={() => start("register", "new")}>Generate validator key</button>
          <button class="btn" disabled={!data} onclick={() => start("register", "enter")}>Use an existing key</button>
        </div>
      {/if}
    {/if}
  </section>

  <section class="card stack">
    <div class="row"><Icon name="edit" /><h2>Username</h2></div>
    {#if data?.username}
      <div class="row">
        <span style="font-size:16px;font-weight:600">{data.username}</span>
        <span class="spacer"></span>
        <button class="btn danger small" onclick={resignName}>Resign username</button>
      </div>
    {/if}
    <p class="muted" style="margin:0">
      {data?.username ? "Replace it with another name:" : "Give this wallet a name others can find it by."} 1–20 lowercase
      letters, digits or single underscores, not at the start or end.
    </p>
    <label class="field">
      Username
      <input bind:value={username} oninput={onName} placeholder="myname" class:invalid={nameStatus === "invalid" || nameStatus === "taken"} spellcheck="false" maxlength="20" />
    </label>
    <div class="small">
      {#if nameStatus === "checking"}<span class="muted">Checking availability…</span>
      {:else if nameStatus === "taken"}<span class="red">That name is taken</span>
      {:else if nameStatus === "free"}<span class="green">Available</span>
      {:else if nameStatus === "invalid"}<span class="red">Use 1–20 lowercase letters, digits or single underscores (not first or last)</span>{/if}
    </div>
    <div><button class="btn primary" disabled={nameStatus !== "free" || !data} onclick={registerName}>{data?.username ? "Change username" : "Register username"}</button></div>
  </section>

  {#if data?.secondPublicKey}
    <section class="card stack">
      <div class="row"><Icon name="key" /><h2>Second passphrase</h2></div>
      <div class="notice ok">This wallet kept its second passphrase from ARK Core. Every transaction needs both passphrases.</div>
      <div class="faint small mono brk">Second public key: {data.secondPublicKey}</div>
    </section>
  {/if}
</div>

{#if draft}
  <ConfirmTx {wallet} {draft} validatorPassphrase={keyPhrase} onclose={() => (draft = null)} ondone={sent} />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
    align-items: start;
  }
  .key {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 9px 12px;
  }
  .brk {
    word-break: break-all;
  }
</style>
