<script lang="ts">
  import Icon from "./Icon.svelte";
  import { shieldScreen } from "../lib/backend";

  let {
    value = $bindable(""),
    placeholder = "Enter passphrase",
    invalid = false,
    autofocus = false,
  }: { value?: string; placeholder?: string; invalid?: boolean; autofocus?: boolean } = $props();
  let show = $state(false);
  let el: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (autofocus && el) el.focus();
  });

  // revealed text is readable on screen: keep it out of screenshots / screen sharing
  $effect(() => {
    if (show) return shieldScreen();
  });
</script>

<div class="secret">
  <input
    bind:this={el}
    type={show ? "text" : "password"}
    bind:value
    {placeholder}
    class:invalid
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    writingsuggestions="false"
  />
  <button type="button" class="btn ghost icon" onclick={() => (show = !show)} title={show ? "Hide" : "Show"}>
    <Icon name={show ? "eyeoff" : "eye"} size={15} />
  </button>
</div>

<style>
  .secret {
    position: relative;
  }
  .secret input {
    padding-right: 40px;
    font-family: var(--mono);
    font-size: 13px;
  }
  .secret .btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 28px;
    height: 28px;
  }
</style>
