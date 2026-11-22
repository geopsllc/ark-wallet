<script lang="ts">
  import Icon from "./Icon.svelte";
  import { backend, shieldScreen } from "../lib/backend";

  let {
    words = 12,
    confirmLabel = "Create",
    oncancel,
    ondone,
  }: { words?: 12 | 24; confirmLabel?: string; oncancel: () => void; ondone: (mnemonic: string) => void } = $props();

  // svelte-ignore state_referenced_locally
  let count = $state<12 | 24>(words);
  let mnemonic = $state("");
  let step = $state<"show" | "check">("show");
  let written = $state(false);
  let checks = $state<{ index: number; value: string }[]>([]);
  let error = $state("");

  // the words are on screen the whole time: keep the window out of screenshots / screen sharing
  $effect(() => shieldScreen());

  async function generate() {
    mnemonic = await backend.generateMnemonic(count);
    written = false;
  }
  $effect(() => {
    void count;
    generate();
  });

  const list = $derived(mnemonic ? mnemonic.split(" ") : []);

  function toCheck() {
    const idx = new Set<number>();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * list.length));
    checks = [...idx].sort((a, b) => a - b).map((index) => ({ index, value: "" }));
    step = "check";
    error = "";
  }

  function finish() {
    if (checks.every((c) => c.value.trim().toLowerCase() === list[c.index])) {
      const m = mnemonic;
      mnemonic = "";
      ondone(m);
    } else error = "Those words don't match. Check your backup and try again.";
  }
</script>

<div class="stack fade">
  {#if step === "show"}
    <div class="row">
      <div class="seg">
        <button class:on={count === 12} onclick={() => (count = 12)}>12 words</button>
        <button class:on={count === 24} onclick={() => (count = 24)}>24 words</button>
      </div>
      <span class="spacer"></span>
      <button class="btn ghost small" onclick={generate}><Icon name="refresh" size={13} /> New</button>
    </div>
    <div class="words">
      {#each list as w, i}
        <div class="word"><span class="faint num">{i + 1}</span>{w}</div>
      {/each}
    </div>
    <div class="notice warn">
      Write these words down on paper, in order, and keep them offline. There is deliberately no copy button: the
      clipboard can be read by other apps and synced to other devices. Anyone with them controls the funds, and this app never
      stores them. If you lose them, nobody can recover them.
    </div>
    <label class="row small" style="cursor:pointer"><input type="checkbox" bind:checked={written} /> I have written down the passphrase</label>
    <div class="row">
      <span class="spacer"></span>
      <button class="btn" onclick={oncancel}>Cancel</button>
      <button class="btn primary" disabled={!written} onclick={toCheck}>Next</button>
    </div>
  {:else}
    <p class="muted" style="margin:0">Confirm your backup: enter these words from your passphrase.</p>
    <div class="checks">
      {#each checks as c}
        <label class="field">Word #{c.index + 1}<input bind:value={c.value} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" writingsuggestions="false" /></label>
      {/each}
    </div>
    {#if error}<div class="notice error">{error}</div>{/if}
    <div class="row">
      <span class="spacer"></span>
      <button class="btn" onclick={() => (step = "show")}>Back</button>
      <button class="btn primary" disabled={checks.some((c) => !c.value.trim())} onclick={finish}>{confirmLabel}</button>
    </div>
  {/if}
</div>

<style>
  .words {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .word {
    display: flex;
    gap: 8px;
    align-items: baseline;
    background: var(--input);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 6px 9px;
    font-family: var(--mono);
    font-size: 13px;
  }
  .word span {
    font-size: 10.5px;
    min-width: 14px;
  }
  .checks {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
</style>
