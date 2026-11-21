<script lang="ts">
  import { walletColor } from "../lib/colors";

  let { name, address, size = 26 }: { name: string; address: string; size?: number } = $props();
  const color = $derived(walletColor(address));
  const initial = $derived((name.trim()[0] ?? "?").toUpperCase());
</script>

<span
  class="avatar"
  style="--c:{color};width:{size}px;height:{size}px;font-size:{Math.round(size * 0.46)}px;border-radius:{Math.round(size * 0.32)}px"
  aria-hidden="true">{initial}</span
>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-weight: 700;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 17%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
  }
</style>
