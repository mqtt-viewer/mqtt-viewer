<script lang="ts" context="module">
  import { writable } from "svelte/store";

  // Exported so the prompt can be opened or inspected from elsewhere if needed.
  export const starPromptOpen = writable(false);
</script>

<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import { openExternal } from "@/util/external";
  import {
    whatsNewResolved,
    whatsNewOpen,
  } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
  import {
    GetAppSettings,
    AcknowledgeStarPrompt,
  } from "bindings/mqtt-viewer/backend/app/app";

  const REPO_URL = "https://github.com/mqtt-viewer/mqtt-viewer";

  // Only nudge once the app has clearly been used a few times, so a fresh
  // install never sees this on first run.
  const MIN_LAUNCHES = 3;

  let checked = false;
  let acknowledged = false;
  let wasOpen = false;

  // Decide once, and only after the "What's new" dialog has had its say. If
  // it's showing this launch, hold off rather than stack two prompts. The seen
  // flag stays unset, so the nudge just waits for a later launch.
  $: if (!checked && $whatsNewResolved) {
    checked = true;
    if (!$whatsNewOpen) {
      (async () => {
        try {
          const settings = await GetAppSettings();
          if (
            !settings.hasSeenStarPrompt &&
            settings.launchCount >= MIN_LAUNCHES
          ) {
            starPromptOpen.set(true);
          }
        } catch (e) {
          console.error("Failed to check star prompt state", e);
        }
      })();
    }
  }

  // Acknowledge on any close (button, the X, Escape, overlay click) so it never
  // shows again, whether the user starred or dismissed it.
  $: {
    if ($starPromptOpen) {
      wasOpen = true;
    } else if (wasOpen) {
      wasOpen = false;
      acknowledge();
    }
  }

  const acknowledge = async () => {
    if (acknowledged) return;
    acknowledged = true;
    try {
      await AcknowledgeStarPrompt();
    } catch (e) {
      console.error("Failed to acknowledge star prompt", e);
    }
  };

  const onStar = () => {
    openExternal(REPO_URL);
    starPromptOpen.set(false);
  };

  const onLater = () => {
    starPromptOpen.set(false);
  };
</script>

<Dialog title="Like the app?" isOpen={starPromptOpen}>
  <div class="flex flex-col gap-5 mt-1 w-[400px]">
    <p class="text-secondary-text">
      Starring the project on GitHub is an easy way to help out. It helps more
      people find MQTT Viewer, and it's a real boost for me to see. Thanks for
      using it.
    </p>

    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={onLater}>Maybe later</Button>
      <Button variant="primary" on:click={onStar}>Star on GitHub</Button>
    </div>
  </div>
</Dialog>
