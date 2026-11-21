<script lang="ts">
  /** Address that truncates in the middle only when it doesn't fit (keeps the last `tail` characters). */
  let { address, tail = 8, cls = "" }: { address: string; tail?: number; cls?: string } = $props();
  const head = $derived(address.slice(0, -tail));
  const end = $derived(address.slice(-tail));
</script>

<span class="addr mono {cls}" title={address}><span class="head">{head}</span><span class="end">{end}</span></span>

<style>
  .addr {
    display: flex;
    min-width: 0;
    max-width: 100%;
    white-space: nowrap;
  }
  .head {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 2ch;
  }
  .end {
    flex-shrink: 0;
  }
</style>
