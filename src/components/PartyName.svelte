<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { walletColor } from "../lib/colors";
  import { shortAddress } from "../lib/format";
  import { openExternal } from "../lib/backend";
  import type { NetworkId } from "../lib/types";

  /** Shows the best known name for an address: one of your wallets, else its delegate username, else a short address. */
  let { network, address, chars = 7 }: { network: NetworkId; address: string; chars?: number } = $props();

  const own = $derived(app.wallets.find((w) => w.address === address));
  let delegate = $state<string | null>(null);

  $effect(() => {
    const addr = address;
    delegate = null;
    if (own) return;
    ark.addressName(app.apiUrl(network), addr).then((n) => {
      if (addr === address) delegate = n;
    });
  });
</script>

<button
  class="xlink"
  title="{address} · open in explorer"
  onclick={(e) => {
    e.stopPropagation();
    openExternal(app.explorerAddress(network, address));
  }}
>
  {#if own}
    <span class="own" style="color:{walletColor(own)}">{own.name}</span>
  {:else if delegate}
    <span class="accent">{delegate}</span>
  {:else}
    <span class="mono">{shortAddress(address, chars)}</span>
  {/if}
</button>

<style>
  .own {
    font-weight: 600;
  }
</style>
