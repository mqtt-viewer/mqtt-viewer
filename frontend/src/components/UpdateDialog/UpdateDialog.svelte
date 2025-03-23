<script lang="ts">
  import { writable } from "svelte/store";
  import Dialog from "../Dialog/Dialog.svelte";
  import DialogActionBar from "../Dialog/DialogActionBar.svelte";
  import updateStore from "@/stores/update";
  import Button from "../Button/Button.svelte";
  import { addToast } from "../Toast/Toast.svelte";
  import { Square } from "svelte-loading-spinners";
  import { StartUpdate } from "wailsjs/go/app/App";
  import env from "@/stores/env";

  let isOpen = writable(false);
  let isUpdating = false;
  $: $updateStore.isUpdateDialogOpen,
    (() => {
      isOpen.set($updateStore.isUpdateDialogOpen);
    })();
  const onClose = () => {
    updateStore.closeUpdateDialog();
  };
  const onConfirm = async () => {
    try {
      isUpdating = true;
      // if ($env.version === "0.0.0-dev") {
      //   throw "Cannot update in development mode";
      // }
      console.log("starting update");
      await StartUpdate();
    } catch (e) {
      isUpdating = false;
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

<Dialog
  title={!isUpdating ? "Begin update?" : "MQTT Viewer is updating"}
  {isOpen}
  onClose={!isUpdating ? onClose : undefined}
  showCloseButton={!isUpdating}
>
  {#if !isUpdating}
    <div>
      This will download and install MQTT Viewer version {$updateStore
        .availableUpdate?.latest_version}.
    </div>
    <div class="my-6">
      Don't close MQTT Viewer while the update is in progress!
    </div>
    <DialogActionBar
      ><Button on:click={onClose} variant="secondary">Close</Button><Button
        variant="primary"
        on:click={onConfirm}>Begin Update</Button
      ></DialogActionBar
    >
  {:else}
    <div class="flex flex-col items-center gap-4 my-8">
      <Square color={"#7c8cff"} size="40" unit="px" duration="4s" />
    </div>
    The app will restart itself once the update is complete.
  {/if}
</Dialog>
