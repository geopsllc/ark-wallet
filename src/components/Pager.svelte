<script lang="ts">
  /** Page navigation: First, Prev, numbered pages (current ±span, first and last, "…" for gaps), Next, Last. */
  let {
    page = $bindable(1),
    pageCount,
    span = 2,
  }: { page: number; pageCount: number; span?: number } = $props();

  const items = $derived.by(() => {
    const n = Math.max(1, pageCount);
    const set = new Set<number>([1, n]);
    for (let p = page - span; p <= page + span; p++) if (p >= 1 && p <= n) set.add(p);
    const sorted = [...set].sort((a, b) => a - b);
    const out: (number | "gap")[] = [];
    sorted.forEach((p, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        if (p - prev === 2) out.push(prev + 1); // a single missing page: show it instead of "…"
        else if (p - prev > 2) out.push("gap");
      }
      out.push(p);
    });
    return out;
  });

  function go(p: number) {
    page = Math.min(Math.max(1, p), Math.max(1, pageCount));
  }
</script>

{#if pageCount > 1}
  <nav class="pager" aria-label="Pages">
    <button class="pg wide" disabled={page <= 1} onclick={() => go(1)} title="First page">« First</button>
    <button class="pg wide" disabled={page <= 1} onclick={() => go(page - 1)} title="Previous page">‹ Prev</button>
    {#each items as it, i (typeof it === "number" ? it : `gap${i}`)}
      {#if it === "gap"}
        <span class="gap">…</span>
      {:else}
        <button class="pg num" class:on={it === page} aria-current={it === page ? "page" : undefined} onclick={() => go(it)}>
          {it.toLocaleString()}
        </button>
      {/if}
    {/each}
    <button class="pg wide" disabled={page >= pageCount} onclick={() => go(page + 1)} title="Next page">Next ›</button>
    <button class="pg wide" disabled={page >= pageCount} onclick={() => go(pageCount)} title="Last page">Last »</button>
  </nav>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pg {
    all: unset;
    box-sizing: border-box;
    min-width: 30px;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--muted);
    border: 1px solid var(--border);
    background: var(--card);
    cursor: pointer;
    white-space: nowrap;
  }
  .pg:hover:not(:disabled) {
    background: var(--card-hover);
    color: var(--text);
  }
  .pg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .pg.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    cursor: default;
  }
  .pg:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .gap {
    color: var(--faint);
    padding: 0 2px;
    font-size: 12.5px;
  }
</style>
