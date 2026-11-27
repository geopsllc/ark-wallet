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
  let charW = $state(0);
  let trim = $state(0); // extra characters dropped when the rendered text still overflowed

  // Width and character width are both re-measured on every resize and once web fonts are ready: measuring the
  // character width only once could catch the fallback font and keep a cut that is too long.
  function measure() {
    if (!box || !probe) return;
    avail = box.getBoundingClientRect().width; // fractional, not rounded
    charW = probe.getBoundingClientRect().width / address.length; // monospace: every character is the same width
    trim = 0;
  }
  $effect(() => {
    if (!center || !box || !probe) return;
    void address;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  });

  const shown = $derived.by(() => {
    if (!center || !avail || !charW) return address;
    const fit = Math.floor((avail - 0.5) / charW) - trim; // never round up
    if (fit >= address.length) return address;
    const keep = Math.max(fit - 1, 4); // one slot for "…"
    return address.slice(0, Math.ceil(keep / 2)) + "…" + address.slice(address.length - Math.floor(keep / 2));
  });

  // safety net: if the text as drawn is still wider than its box, drop one more character
  $effect(() => {
    void shown;
    if (!center || !box || !box.firstChild || shown === address && trim === 0) return;
    const r = document.createRange();
    r.selectNodeContents(box.firstChild);
    if (r.getBoundingClientRect().width > box.getBoundingClientRect().width + 0.5 && trim < 6) trim += 1;
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
