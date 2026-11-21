import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

async function start() {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installDevMock } = await import("./lib/devmock");
    installDevMock();
    // dev-only handle for poking at state from the browser console
    (window as any).__app = (await import("./lib/state.svelte")).app;
  }
  mount(App, { target: document.getElementById("app")! });
}

start();
