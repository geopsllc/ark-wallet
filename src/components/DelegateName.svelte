<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { ark } from "../lib/ark";
  import { shortAddress } from "../lib/format";
  import type { NetworkId } from "../lib/types";

  let { network, publicKey }: { network: NetworkId; publicKey: string } = $props();
  let name = $state("");

  $effect(() => {
    name = "";
    ark
      .delegate(app.apiUrl(network), publicKey)
      .then((d) => (name = d.username))
      .catch(() => {});
  });
</script>

<span class:accent={!!name}>{name || shortAddress(publicKey, 6)}</span>
