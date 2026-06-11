<script lang="ts">
  import { writable } from "svelte/store";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogActionBar from "../Dialog/DialogActionBar.svelte";
  import updateStore from "@/stores/update";
  import Button from "../Button/Button.svelte";
  import { addToast } from "../Toast/Toast.svelte";
  import { StartUpdate } from "bindings/mqtt-viewer/backend/app/app";

  let isOpen = writable(false);
  $: $updateStore.isUpdateDialogOpen,
    (() => {
      isOpen.set($updateStore.isUpdateDialogOpen);
    })();
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
</script>

<Dialog title="Begin update?" {isOpen} {onClose} showCloseButton>
  <div>
    This will download and install MQTT Viewer version {$updateStore
      .availableUpdate?.latest_version}.
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
</Dialog>
