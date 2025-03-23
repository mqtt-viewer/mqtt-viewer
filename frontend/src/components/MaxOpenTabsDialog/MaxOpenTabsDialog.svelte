<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable } from "svelte/store";
  import tabs from "@/stores/tabs";
  import Button from "@/components/Button/Button.svelte";

  let open = writable(false);

  $: $tabs.isMaxOpenTabsDialogOpen,
    (() => {
      open.set($tabs.isMaxOpenTabsDialogOpen);
    })();

  const onCancel = () => {
    tabs.closeMaxOpenTabsDialog();
  };
</script>

<Dialog title="You can't open any more tabs" onClose={onCancel} isOpen={open}>
  <div class="flex flex-col gap-3 mt-3 w-[400px]">
    <p>Please close one (or more) existing tabs to open a new tab.</p>
    <div class="flex gap-3 justify-end items-center">
      <Button on:click={onCancel}>Got it</Button>
    </div>
  </div>
</Dialog>
