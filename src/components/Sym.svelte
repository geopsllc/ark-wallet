<script lang="ts">
  import { NETWORKS, type NetworkId } from "../lib/types";

  /** The network's currency symbol (Ѧ), sized to the number it follows, in ARK red. */
  let { network = "mainnet" }: { network?: NetworkId } = $props();
  const n = $derived(NETWORKS[network]);
</script>

<span class="sym" title={n.token}>{n.symbol}</span>

<style>
  .sym {
    font-size: 1em;
    font-weight: inherit;
    color: var(--brand);
    /* the only gap between a number and its symbol: same everywhere, scales with the type */
    margin-left: 0.2em;
  }
</style>
