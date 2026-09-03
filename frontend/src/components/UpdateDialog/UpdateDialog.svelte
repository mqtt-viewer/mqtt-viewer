<script lang="ts" context="module">
  import { writable } from "svelte/store";

  // Set true once the startup auto-prompt question is settled: no update
  // exists, the available version was skipped earlier, or the auto-opened
  // dialog was closed. Later nudges (the GitHub star prompt) wait on this so
  // they never land on top of the update dialog.
  export const updatePromptResolved = writable(false);

  // True once the update dialog has been shown this launch, whether by the
  // auto-prompt or from the bell. The star prompt defers to a later launch
  // when set.
  export const updateDialogShown = writable(false);
</script>

<script lang="ts">
  import { openExternal } from "@/util/external";
  import Dialog from "../Dialog/Dialog.svelte";
  import UpdateAvailableContent from "./UpdateAvailableContent.svelte";
  import updateStore from "@/stores/update";
  import env from "@/stores/env";
  import { addToast } from "../Toast/Toast.svelte";
  import { normalise } from "@/changelog";
  import {
    GetAppSettings,
    SkipUpdateVersion,
    StartUpdate,
  } from "bindings/mqtt-viewer/backend/app/app";
  import {
    firstRunGateCleared,
    whatsNewOpen,
    whatsNewResolved,
  } from "../WhatsNewDialog/WhatsNewDialog.svelte";
  import { starPromptOpen } from "../StarPromptDialog/StarPromptDialog.svelte";

  let isOpen = writable(false);
  $: $updateStore.isUpdateDialogOpen,
    (() => {
      isOpen.set($updateStore.isUpdateDialogOpen);
    })();

  // The Dialog invokes onClose once during init because its store starts
  // false, so only treat closes after a real open as resolving the prompt.
  let wasShown = false;
  $: if ($updateStore.isUpdateDialogOpen) {
    wasShown = true;
    updateDialogShown.set(true);
  }

  // Each distinct version auto-prompts at most once per session, so "Remind
  // me later" holds until the next launch (or a newer version turns up in a
  // later poll). The bell notification can still reopen it manually.
  let autoPromptedVersion = "";
  let updating = false;

  // The first update check found nothing, so the startup prompt question is
  // settled and later nudges may proceed.
  $: if ($updateStore.hasCheckedOnce && !$updateStore.availableUpdate)
    updatePromptResolved.set(true);

  // Auto-open once the first-run and "What's new" dialogs have had their
  // turn (and the latter is not currently reopened from Settings), and only
  // while the star prompt is not showing, so dialogs never stack.
  $: if (
    $updateStore.availableUpdate &&
    $firstRunGateCleared &&
    $whatsNewResolved &&
    !$whatsNewOpen &&
    !$starPromptOpen &&
    autoPromptedVersion !== $updateStore.availableUpdate.latest_version
  ) {
    autoPromptedVersion = $updateStore.availableUpdate.latest_version;
    maybeAutoPrompt($updateStore.availableUpdate.latest_version);
  }

  const maybeAutoPrompt = async (latestVersion: string) => {
    try {
      const settings = await GetAppSettings();
      if (
        normalise(latestVersion) ===
        normalise(settings.ignoredUpdateVersion ?? "")
      ) {
        // The user skipped this version, so the prompt is settled without
        // showing anything.
        updatePromptResolved.set(true);
      } else {
        updateStore.openUpdateDialog();
      }
    } catch (e) {
      console.error("Failed to check skipped update version", e);
      // A failed settings read gives up on auto-prompting this version for
      // the session; the bell notification still offers the update. Keeping
      // the latch avoids a retry loop, and resolving the prompt keeps
      // downstream nudges from deadlocking.
      updatePromptResolved.set(true);
    }
  };

  const onClose = () => {
    updateStore.closeUpdateDialog();
    if (wasShown) updatePromptResolved.set(true);
  };

  const onUpdate = async () => {
    const update = $updateStore.availableUpdate;
    if (!update) return;
    if (update.can_self_update) {
      updating = true;
      try {
        // Hands over to the built-in Wails updater window, which walks the
        // user through download, verification and restart.
        await StartUpdate();
        updateStore.closeUpdateDialog();
      } catch (e) {
        addToast({
          data: {
            title: "Failed to update",
            description: e as string,
            type: "error",
          },
        });
      } finally {
        updating = false;
      }
    } else if (update.releases_url) {
      // Package-managed installs update outside the app; send the user to
      // the releases page instead.
      openExternal(update.releases_url);
      updateStore.closeUpdateDialog();
    }
  };

  const onCopyCommand = async () => {
    const update = $updateStore.availableUpdate;
    if (!update?.update_command) {
      return;
    }
    await navigator.clipboard.writeText(update.update_command);
    addToast({
      data: {
        title: "Copied",
        description: "Update command copied to your clipboard.",
        type: "success",
      },
    });
  };

  const onRemindLater = () => {
    updateStore.closeUpdateDialog();
  };

  const onSkip = async () => {
    const update = $updateStore.availableUpdate;
    if (update) {
      try {
        await SkipUpdateVersion(update.latest_version);
      } catch (e) {
        console.error("Failed to skip update version", e);
      }
    }
    updateStore.closeUpdateDialog();
  };
</script>

{#if $updateStore.availableUpdate}
  <Dialog title="Update available" {isOpen} {onClose} showCloseButton>
    <UpdateAvailableContent
      update={$updateStore.availableUpdate}
      currentVersion={$env.version}
      {updating}
      {onUpdate}
      {onRemindLater}
      {onSkip}
      {onCopyCommand}
    />
  </Dialog>
{/if}
