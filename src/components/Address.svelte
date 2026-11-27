<script lang="ts">
  /** Address that truncates only when it doesn't fit. By default the cut sits near the end (the last `tail`
   *  characters stay). With `center` it fills the room it has and is cut in the middle as ONE string
   *  ("AN9Niar…93txSup"): no half-clipped character after the "…", and a hover underline runs under all of it.
   *  `within`: a selector for the line it sits on; the room is that line's width minus everything else on it.
   *  (Measuring the address's own box doesn't work in WebKit, where that box shrinks with its text.) */
  let { address, tail = 8, cls = "", center = false, within = "" }: { address: string; tail?: number; cls?: string; center?: boolean; within?: string } = $props();
  const head = $derived(address.slice(0, address.length - tail));
  const end = $derived(address.slice(address.length - tail));

  let box = $state<HTMLSpanElement>();
  let probe = $state<HTMLSpanElement>();
  let avail = $state(0);
  let charW = $state(0);

  function room(el: HTMLElement): number {
    const line = within ? (el.closest(within) as HTMLElement | null) : null;
    if (!line) return el.getBoundingClientRect().width;
    // the line's direct child that holds us (e.g. the link button, which also holds an icon)
    let mine: HTMLElement = el;
    while (mine.parentElement && mine.parentElement !== line) mine = mine.parentElement;
    const kids = [...line.children] as HTMLElement[];
    const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
    let others = gap * Math.max(kids.length - 1, 0);
    for (const k of kids) if (k !== mine) others += k.getBoundingClientRect().width;
    const extra = mine.getBoundingClientRect().width - el.getBoundingClientRect().width; // icon + gap inside the link
    return line.getBoundingClientRect().width - others - extra;
  }

  // re-measured on every resize and once web fonts are ready (a first measurement can catch the fallback font)
  function measure() {
    if (!box || !probe) return;
    avail = Math.max(room(box), 0);
    charW = probe.getBoundingClientRect().width / address.length; // monospace: every character is the same width
  }
  $effect(() => {
    if (!center || !box || !probe) return;
    void address;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    const line = within ? box.closest(within) : null;
    if (line) ro.observe(line);
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  });

  const shown = $derived.by(() => {
    if (!center || !avail || !charW) return address;
    const fit = Math.floor((avail - 0.5) / charW); // never round up
    if (fit >= address.length) return address;
    const keep = Math.max(fit - 1, 4); // one slot for "…"
    return address.slice(0, Math.ceil(keep / 2)) + "…" + address.slice(address.length - Math.floor(keep / 2));
  });
  // the leftover sliver (< 1 character) is spread over the letters, so a cut address starts right after "from"
  // and still ends flush right
  const spacing = $derived(
    within && shown !== address && charW ? Math.max(0, Math.min(1.5, (avail - shown.length * charW) / shown.length)) : 0,
  );
</script>

{#if center}
  <span class="addr mono fill {cls}" class:cut={shown !== address} style:width={within && shown !== address ? `${avail}px` : null} style:flex={within && shown !== address ? "none" : null} style:letter-spacing={spacing ? `${spacing}px` : null} bind:this={box} title={address}>{shown}<span class="probe" bind:this={probe} aria-hidden="true">{address}</span></span>
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
  .probe {
    position: absolute;
    letter-spacing: 0; /* measures the plain character width, unaffected by the spacing above */
    visibility: hidden;
    left: 0;
    top: 0;
  }
</style>
