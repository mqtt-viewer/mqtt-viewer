<script lang="ts">
  import { writable } from "svelte/store";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogActionBar from "../Dialog/DialogActionBar.svelte";
  import updateStore from "@/stores/update";
  import Button from "../Button/Button.svelte";
  import { addToast } from "../Toast/Toast.svelte";
  import { StartUpdate } from "bindings/mqtt-viewer/backend/app/app";
  import { Browser } from "@wailsio/runtime";

  let isOpen = writable(false);
  $: $updateStore.isUpdateDialogOpen,
    (() => {
      isOpen.set($updateStore.isUpdateDialogOpen);
    })();

  $: availableUpdate = $updateStore.availableUpdate;
  $: canSelfUpdate = availableUpdate?.can_self_update ?? false;
  $: title = canSelfUpdate ? "Begin update?" : "Update available";

  const onClose = () => {
    updateStore.closeUpdateDialog();
  };
  const onConfirm = async () => {
    try {
      console.log("starting update");
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
    }
  };

  const onCopyCommand = async () => {
    if (!availableUpdate?.update_command) {
      return;
    }
    await navigator.clipboard.writeText(availableUpdate.update_command);
    addToast({
      data: {
        title: "Copied",
        description: "Update command copied to your clipboard.",
        type: "success",
      },
    });
  };

  const onOpenReleases = () => {
    if (availableUpdate?.releases_url) {
      Browser.OpenURL(availableUpdate.releases_url);
    }
  };
</script>

<Dialog {title} {isOpen} {onClose} showCloseButton>
  {#if availableUpdate}
    {#if canSelfUpdate}
      <div>
        This will download and install MQTT Viewer version {availableUpdate.latest_version}.
      </div>
      <div class="my-6">
        The updater will guide you through the download and restart once it's
        ready.
      </div>
      <DialogActionBar
        ><Button on:click={onClose} variant="secondary">Close</Button><Button
          variant="primary"
          on:click={onConfirm}>Begin Update</Button
        ></DialogActionBar
      >
    {:else}
      <div>
        A new version of MQTT Viewer ({availableUpdate.latest_version}) is
        available.
      </div>
      <div class="my-6">{availableUpdate.instructions}</div>
      {#if availableUpdate.update_command}
        <div class="mb-6 flex items-center gap-2">
          <code
            class="flex-1 select-all overflow-x-auto rounded border border-outline bg-elevation-2 px-3 py-2 font-mono text-sm text-emphasis"
            >{availableUpdate.update_command}</code
          >
          <Button on:click={onCopyCommand} variant="secondary">Copy</Button>
        </div>
      {/if}
      <DialogActionBar>
        <Button on:click={onClose} variant="secondary">Close</Button>
        {#if availableUpdate.releases_url}
          <Button variant="primary" on:click={onOpenReleases}
            >Open releases page</Button
          >
        {/if}
      </DialogActionBar>
    {/if}
  {/if}
</Dialog>
