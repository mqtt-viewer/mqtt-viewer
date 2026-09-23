import { get } from "svelte/store";
import { Browser } from "@wailsio/runtime";
import envStore from "@/stores/env";

// openExternal opens a URL in the user's browser. On the desktop build the
// native webview has no place to put a new tab, so it hands off to the OS
// browser via Browser.OpenURL. In server mode the app already runs in a
// browser, so a plain window.open is both correct and the only thing that
// works (Browser.OpenURL is a no-op headless).
export const openExternal = (url: string) => {
  if (get(envStore).isServerMode) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  Browser.OpenURL(url);
};
