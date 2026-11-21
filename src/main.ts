import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

async function start() {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installDevMock } = await import("./lib/devmock");
    installDevMock();
  }
  mount(App, { target: document.getElementById("app")! });
}

start();
