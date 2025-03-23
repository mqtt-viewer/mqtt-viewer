import "./custom-preflight.css";
import "./style.css";
import App from "./App.svelte";

const app = new App({
  target: document.getElementById("app") as Document | Element | ShadowRoot,
});

export default app;
