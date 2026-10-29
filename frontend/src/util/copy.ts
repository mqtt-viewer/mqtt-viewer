import { get } from "svelte/store";
import { Clipboard } from "@wailsio/runtime";
import envStore from "@/stores/env";

// copyToClipboard writes text to the system clipboard. On the desktop build
// it goes through the native clipboard (NSPasteboard and friends) because
// the webview's navigator.clipboard is unreliable there: WKWebView on recent
// macOS rejects it as not allowed in the current context, or resolves
// without writing anything. In server mode the app runs in the user's own
// browser, where navigator.clipboard is the right API and the native call
// would only touch the server's clipboard.
export const copyToClipboard = async (text: string) => {
  if (get(envStore).isServerMode) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await Clipboard.SetText(text);
};
