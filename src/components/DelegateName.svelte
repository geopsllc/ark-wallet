<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import { chain } from "../lib/chain";
  import { openExternal } from "../lib/backend";
  import { shortAddress } from "../lib/format";
  import type { NetworkId } from "../lib/types";

  let { network, publicKey, link = false }: { network: NetworkId; publicKey: string; link?: boolean } = $props();
  let name = $state("");
  let address = $state("");

  $effect(() => {
    name = "";
    address = "";
    chain(network)
      .delegate(app.apiUrl(network), publicKey)
      .then((d) => {
        name = d.username;
        address = d.address;
      })
      .catch(() => {});
  });
</script>

{#if link && address}
  <button
    class="xlink accent"
    title="{address} · open in explorer"
    onclick={(e) => {
      e.stopPropagation();
      openExternal(app.explorerAddress(network, address));
    }}>{name}<Icon name="external" size={11} /></button
  >
{:else}
  <span class:accent={!!name}>{name || shortAddress(publicKey, 6)}</span>
{/if}
