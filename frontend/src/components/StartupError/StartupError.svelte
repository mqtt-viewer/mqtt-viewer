<script lang="ts">
  import { openExternal } from "@/util/external";

  // Shown by App.svelte when initialization.init() rejects. Nothing else has
  // loaded at that point, so this renders from props alone and must not lean
  // on stores, bindings, or the Wails runtime (any of them may be the reason
  // startup failed).
  export let error: unknown;

  const ISSUES_URL = "https://github.com/mqtt-viewer/mqtt-viewer/issues";

  const describe = (e: unknown): string => {
    if (e instanceof Error) {
      return e.stack && e.stack.includes(e.message)
        ? e.stack
        : [e.message, e.stack].filter(Boolean).join("\n");
    }
    return String(e);
  };

  $: details = describe(error);

  const onLinkClick = (event: MouseEvent) => {
    // Best effort: hand off to the OS browser on desktop. If the runtime is
    // what broke, let the plain href do whatever the webview allows.
    try {
      openExternal(ISSUES_URL);
      event.preventDefault();
    } catch {
      // fall through to the default navigation
    }
  };
</script>

<div
  class="size-full flex flex-col items-center justify-center bg-elevation-0 p-8 text-emphasis"
  style="--wails-draggable:drag"
  role="alert"
>
  <div class="flex w-full max-w-2xl flex-col gap-4">
    <h1 class="text-lg font-semibold">MQTT Viewer failed to initialise</h1>
    <p class="text-secondary-text">
      Something went wrong while I was starting up. The details below will
      help me fix it.
    </p>
    <pre
      class="max-h-80 select-text overflow-auto whitespace-pre-wrap break-words rounded border border-outline bg-elevation-1 p-3 font-mono text-xs text-secondary-text"
      style="--wails-draggable:no-drag">{details}</pre>
    <p class="text-secondary-text">
      Copy them into a new issue at
      <a
        class="select-text text-primary underline"
        style="--wails-draggable:no-drag"
        href={ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
        on:click={onLinkClick}>{ISSUES_URL}</a
      >
      and I will take a look.
    </p>
  </div>
</div>
