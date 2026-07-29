<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import moment from "moment";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { Connection } from "@/stores/connections";
  import ConnectionForm from "@/views/Connection/ConnectionDetailsView/components/ConnectionForm/ConnectionForm.svelte";
  import SubscriptionsForm from "@/views/Connection/ConnectionDetailsView/components/SubscriptionsForm/SubscriptionsForm.svelte";

  export let connection: Connection;
  export let isOpen: Writable<boolean>;

  // Tick every 10s so the "last saved" label keeps advancing while open.
  let now = Date.now();
  const tick = setInterval(() => {
    now = Date.now();
  }, 10_000);
  onDestroy(() => clearInterval(tick));

  $: lastSavedAt = connection.connectionDetails.updatedAt;
  $: lastSavedLabel =
    now && lastSavedAt
      ? `Last saved ${moment(lastSavedAt).fromNow()}`
      : "Autosaves as you type";
</script>

<!--
  Re-hosts the former connection-details page inside a dialog. The forms
  still auto-save each valid field change (Felte); the pinned footer makes
  that visible with a "last saved" label, and Save simply closes the dialog
  since everything is already persisted. Fields disable themselves while
  the connection is connected (handled inside ConnectionForm, which also
  owns the "Connection details" heading + options menu).
-->
<Dialog {isOpen} startEmpty>
  <div class="flex flex-col w-[550px] max-w-[78vw] max-h-[78vh]">
    <div class="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
      <span class="text-lg">Connection settings</span>
      <IconButton onClick={() => isOpen.set(false)}>
        <Icon type="close" size={16} />
      </IconButton>
    </div>
    <div class="grow min-h-0 overflow-y-auto px-6 pb-6">
      <div class="flex flex-col gap-6">
        <ConnectionForm {connection} />
        <SubscriptionsForm {connection} />
      </div>
    </div>
    <div
      class="flex items-center justify-between px-6 py-4 shrink-0 border-t border-divider"
    >
      <span class="text-sm text-secondary-text">{lastSavedLabel}</span>
      <Button variant="primary" on:click={() => isOpen.set(false)}>Save</Button>
    </div>
  </div>
</Dialog>
