<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable } from "svelte/store";

  export let isOpen = writable(false);
  export let title: string;
  export let description: string;
  export let onConfirm: () => void;

  const confirm = () => {
    onConfirm();
    isOpen.set(false);
  };
</script>

<Dialog {isOpen} {title}>
  <div class="flex flex-col gap-3 mt-3">
    <p>{description}</p>
    <p>This cannot be undone.</p>
    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={() => isOpen.set(false)}>Cancel</Button>
      <Button
        iconType="delete"
        class="text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
        iconPlacement="left"
        iconSize={16}
        on:click={confirm}>Delete</Button
      >
    </div>
  </div>
</Dialog>
