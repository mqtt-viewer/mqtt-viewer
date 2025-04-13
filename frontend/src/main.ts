import "./custom-preflight.css";
import "./style.css";
import App from "./App.svelte";
import { mount } from "svelte";

const app = mount(App, {
  target: document.getElementById("app") as Document | Element | ShadowRoot,
});

export default app;
