<script lang="ts">
  import { walletColor } from "../lib/colors";
  import type { WalletEntry } from "../lib/types";

  let { wallet, size = "md" }: { wallet: WalletEntry; size?: "sm" | "md" | "lg" } = $props();
</script>

<span class="wtag {size}" style="--c:{walletColor(wallet)}" title={wallet.name}>{wallet.name}</span>

<style>
  .wtag {
    display: inline-block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 650;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 38%, transparent);
    border-radius: 7px;
    padding: 1px 8px;
    line-height: 1.5;
  }
  .sm {
    font-size: 13px;
    padding: 0 7px;
  }
  .md {
    font-size: 14px;
  }
  .lg {
    font-size: 20px;
    padding: 2px 11px;
    border-radius: 9px;
  }
</style>
