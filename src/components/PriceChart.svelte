<script lang="ts">
  import { formatFiat } from "../lib/format";

  let { points, currency, height = 120 }: { points: [number, number][]; currency: string; height?: number } = $props();

  const W = 600;
  let hover = $state<number | null>(null);
  let svgEl: SVGSVGElement | undefined = $state();

  const stats = $derived.by(() => {
    if (points.length < 2) return null;
    const ys = points.map((p) => p[1]);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const t0 = points[0][0];
    const t1 = points[points.length - 1][0];
    const pad = (max - min) * 0.12 || max * 0.01 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const area = `${line}L${W},${height}L0,${height}Z`;
    const up = points[points.length - 1][1] >= points[0][1];
    return { min, max, x, y, line, area, up };
  });

  function onmove(e: MouseEvent) {
    if (!svgEl || points.length < 2) return;
    const r = svgEl.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    hover = Math.max(0, Math.min(points.length - 1, Math.round(fx * (points.length - 1))));
  }
</script>

{#if stats}
  <div class="chart">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      bind:this={svgEl}
      viewBox="0 0 {W} {height}"
      preserveAspectRatio="none"
      style="height:{height}px"
      onmousemove={onmove}
      onmouseleave={() => (hover = null)}
    >
      <defs>
        <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#73BFFF" stop-opacity="0.28" />
          <stop offset="1" stop-color="#73BFFF" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={stats.area} fill="url(#pc-fill)" />
      <path d={stats.line} fill="none" stroke="#73BFFF" stroke-width="2" vector-effect="non-scaling-stroke" />
      {#if hover !== null}
        {@const p = points[hover]}
        <line x1={stats.x(p[0])} x2={stats.x(p[0])} y1="0" y2={height} stroke="rgba(255,255,255,0.18)" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
    {#if hover !== null}
      {@const p = points[hover]}
      <!-- HTML dot: the SVG stretches (preserveAspectRatio none), which would squash an SVG circle -->
      <div class="dot" style="left:{(stats.x(p[0]) / W) * 100}%;top:{stats.y(p[1])}px"></div>
      <div class="tip" style="left:{(stats.x(p[0]) / W) * 100}%">
        <b class="usd">{formatFiat(p[1], currency)}</b>
        <span>{new Date(p[0]).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    {/if}
    <div class="axis faint small">
      <span>7 days ago</span>
      <span>low <span class="usd">{formatFiat(stats.min, currency)}</span> · high <span class="usd">{formatFiat(stats.max, currency)}</span></span>
      <span>now</span>
    </div>
  </div>
{:else}
  <div class="faint small" style="height:{height}px;display:flex;align-items:center;justify-content:center">No price history</div>
{/if}

<style>
  .chart {
    position: relative;
  }
  svg {
    width: 100%;
    display: block;
  }
  .dot {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #73bfff;
    border: 2px solid var(--panel);
    box-shadow: 0 0 0 1px rgba(115, 191, 255, 0.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    padding: 4px 8px;
    font-size: 11.5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    white-space: nowrap;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
  }
  .tip span {
    color: var(--muted);
  }
</style>
