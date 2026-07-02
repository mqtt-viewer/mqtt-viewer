<script lang="ts" context="module">
  import { writable } from "svelte/store";

  // Exported so Settings (or anywhere) can reopen the current version's notes.
  export const whatsNewOpen = writable(false);

  // Set true once the first-run retention prompt has resolved (either it was
  // never needed, or the user dismissed it). Keeps the two dialogs from
  // stacking on a fresh install.
  export const firstRunGateCleared = writable(false);
</script>

<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import WhatsNewContent from "./WhatsNewContent.svelte";
  import env from "@/stores/env";
  import { entryForVersion, shouldShowChangelog } from "@/changelog";
  import {
    GetAppSettings,
    AcknowledgeChangelog,
  } from "bindings/mqtt-viewer/backend/app/app";

  let checked = false;
  let acknowledged = false;

  $: entry = $env.version ? entryForVersion($env.version) : null;

  // Auto-open once per version: wait for the version to load and the
  // first-run prompt to clear, then compare against the last-seen version.
  $: if (!checked && $env.version && $firstRunGateCleared) {
    checked = true;
    (async () => {
      try {
        const settings = await GetAppSettings();
        if (
          shouldShowChangelog(
            $env.version,
            settings.lastSeenChangelogVersion ?? ""
          )
        ) {
          whatsNewOpen.set(true);
        }
      } catch (e) {
        console.error("Failed to check changelog state", e);
      }
    })();
  }

  const close = async () => {
    whatsNewOpen.set(false);
    if (acknowledged) return;
    acknowledged = true;
    try {
      await AcknowledgeChangelog($env.version);
    } catch (e) {
      console.error("Failed to acknowledge changelog", e);
    }
  };
</script>

{#if entry}
  <Dialog title={entry.headline} isOpen={whatsNewOpen} showCloseButton={false}>
    <WhatsNewContent {entry} onClose={close} />
  </Dialog>
{/if}
