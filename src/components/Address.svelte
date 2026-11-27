<script lang="ts">
  /** Address that truncates only when it doesn't fit. By default the cut sits near the end (the last `tail`
   *  characters stay). With `center` it fills the width it is given and is cut in the middle as ONE string
   *  ("AN9Niar…93txSup"): measured, so there's no half-clipped character after the "…" and a hover underline
   *  runs under the whole thing. */
  let { address, tail = 8, cls = "", center = false }: { address: string; tail?: number; cls?: string; center?: boolean } = $props();
  const head = $derived(address.slice(0, address.length - tail));
  const end = $derived(address.slice(address.length - tail));

  let box = $state<HTMLSpanElement>();
  let probe = $state<HTMLSpanElement>();
  let avail = $state(0);

  $effect(() => {
    if (!center || !box) return;
    const ro = new ResizeObserver(() => (avail = box!.clientWidth));
    ro.observe(box);
    return () => ro.disconnect();
  });

  const shown = $derived.by(() => {
    if (!center || !probe || !avail) return address;
    const charW = probe.getBoundingClientRect().width / address.length; // monospace: every char is the same width
    const fit = Math.floor((avail + 0.5) / charW);
    if (fit >= address.length) return address;
    const keep = Math.max(fit - 1, 4); // one slot for "…"
    return address.slice(0, Math.ceil(keep / 2)) + "…" + address.slice(address.length - Math.floor(keep / 2));
  });
</script>

{#if center}
  <span class="addr mono fill {cls}" class:cut={shown !== address} bind:this={box} title={address}>{shown}<span class="probe" bind:this={probe} aria-hidden="true">{address}</span></span>
{:else}
  <span class="addr mono {cls}" title={address}><span class="head">{head}</span><span class="end">{end}</span></span>
{/if}

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
  /* centred: takes the room it's given; the text is cut to fit by the script above */
  .fill {
    display: block;
    flex: 1 1 0;
    width: 100%;
    overflow: hidden;
    position: relative;
  }
  /* when cut, the leftover sliver (< 1 character) goes before the text, so cut addresses all end flush right */
  .cut {
    text-align: right;
  }
  .probe {
    position: absolute;
    visibility: hidden;
    left: 0;
    top: 0;
  }
</style>
