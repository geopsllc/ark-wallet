<script lang="ts">
  import Sidebar from "./components/Sidebar.svelte";
  import Dashboard from "./components/Dashboard.svelte";
  import WalletView from "./components/WalletView.svelte";
  import SettingsView from "./components/SettingsView.svelte";
  import AddWallet from "./components/AddWallet.svelte";
  import Toasts from "./components/Toasts.svelte";
  import TxOverlay from "./components/TxOverlay.svelte";
  import { app } from "./lib/state.svelte";

  let adding = $state(false);

  $effect(() => {
    app.init();
  });

  const current = $derived(app.view.name === "wallet" ? app.wallet(app.view.id) : undefined);
</script>

<div class="shell">
  <Sidebar onadd={() => (adding = true)} />
  <main>
    <div class="content">
      {#if !app.loaded}
        <div class="row muted"><span class="spinner"></span> Loading…</div>
      {:else if app.view.name === "settings"}
        <SettingsView />
      {:else if current}
        <WalletView wallet={current} />
      {:else}
        <Dashboard onadd={() => (adding = true)} />
      {/if}
    </div>
  </main>
</div>

{#if adding}<AddWallet onclose={() => (adding = false)} />{/if}
<Toasts />
<TxOverlay />

<style>
  .shell {
    display: flex;
    height: 100vh;
  }
  main {
    flex: 1;
    /* always keep the scrollbar lane (the macOS webview ignores scrollbar-gutter),
       so content width never jumps when a page grows tall enough to scroll */
    overflow-y: scroll;
    min-width: 0;
  }
  .content {
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px 28px 40px;
  }
</style>
