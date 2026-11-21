<script lang="ts">
  import { copyText } from "../lib/backend";
  import Icon from "./Icon.svelte";

  let { text, label = "" }: { text: string; label?: string } = $props();
  let done = $state(false);

  async function copy(e: MouseEvent) {
    e.stopPropagation();
    await copyText(text);
    done = true;
    setTimeout(() => (done = false), 1200);
  }
</script>

<button class="btn ghost {label ? 'small' : 'icon'}" title="Copy" onclick={copy}>
  <span class:green={done}><Icon name={done ? "check" : "copy"} size={14} /></span>
  {#if label}{done ? "Copied" : label}{/if}
</button>

<style>
  .btn.icon {
    width: 26px;
    height: 26px;
  }
  span {
    display: inline-flex;
  }
</style>
