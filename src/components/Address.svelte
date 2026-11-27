<script lang="ts">
  /** Address that truncates only when it doesn't fit. By default the cut sits near the end (the last `tail`
   *  characters stay); with `center`, both halves give up the same width so the "…" stays in the middle. */
  let { address, tail = 8, cls = "", center = false }: { address: string; tail?: number; cls?: string; center?: boolean } = $props();
  const cut = $derived(center ? Math.ceil(address.length / 2) : address.length - tail);
  const head = $derived(address.slice(0, cut));
  const end = $derived(address.slice(cut));
</script>

<span class="addr mono {cls}" class:center title={address}><span class="head">{head}</span><span class="end">{end}</span></span>

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
  /* centred: the halves shrink equally; the second is right-aligned and clipped at its start */
  .center .head,
  .center .end {
    flex: 0 1 auto;
    min-width: 2ch;
  }
  .center .end {
    overflow: hidden;
    direction: rtl;
  }
</style>
