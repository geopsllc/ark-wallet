<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { openExternal } from "../lib/backend";
  import Icon from "./Icon.svelte";
</script>

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast fade {t.kind}">
      <Icon name={t.kind === "ok" ? "check" : t.kind === "error" ? "x" : "message"} size={15} />
      <div class="txt">
        {t.text}
        {#if t.link}<button class="lnk" onclick={() => openExternal(t.link!.url)}>{t.link.label}</button>{/if}
      </div>
      <button class="btn ghost icon" onclick={() => app.dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={13} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 18px;
    bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    max-width: 420px;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 8px 10px 14px;
    border-radius: 10px;
    background: var(--card);
    border: 1px solid var(--border-strong);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
    font-size: 13px;
  }
  .toast :global(svg) {
    margin-top: 2px;
  }
  .toast.ok :global(svg:first-child) {
    color: var(--green);
  }
  .toast.error :global(svg:first-child) {
    color: var(--red);
  }
  .toast.info :global(svg:first-child) {
    color: var(--accent);
  }
  .txt {
    flex: 1;
    word-break: break-word;
  }
  .lnk {
    margin-left: 6px;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
  }
  .lnk:hover {
    text-decoration: underline;
  }
  .toast .btn.icon {
    width: 22px;
    height: 22px;
  }
</style>
