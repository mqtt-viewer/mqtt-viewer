<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Writable } from "svelte/store";
  import { writable } from "svelte/store";
  import { melt } from "@melt-ui/svelte";
  import moment from "moment";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { Connection } from "@/stores/connections";
  import lastSavedStore from "@/stores/last-saved";
  import { getConnectionIsValidContext } from "@/views/Connection/contexts/connection-is-valid";
  import ConnectionForm from "@/views/Connection/ConnectionDetailsView/components/ConnectionForm/ConnectionForm.svelte";
  import SubscriptionsForm from "@/views/Connection/ConnectionDetailsView/components/SubscriptionsForm/SubscriptionsForm.svelte";

  export let connection: Connection;
  export let isOpen: Writable<boolean>;

  // Written by ConnectionForm. Falls back to always-valid when no provider
  // exists (Storybook renders this dialog without Connection.svelte).
  const connectionIsValid = getConnectionIsValidContext() ?? writable(true);

  // Tick every 10s while the dialog is open so the "last saved" label keeps
  // advancing. Rows stay mounted while closed, so don't tick then.
  let now = Date.now();
  let tick: ReturnType<typeof setInterval> | undefined;
  const stopTick = () => {
    if (tick) {
      clearInterval(tick);
      tick = undefined;
    }
  };
  $: if ($isOpen && !tick) {
    now = Date.now();
    tick = setInterval(() => {
      now = Date.now();
    }, 10_000);
  } else if (!$isOpen && tick) {
    stopTick();
  }
  onDestroy(stopTick);

  // The session stamp advances the label live; the DB value seeds it after a
  // restart. `_tick` only forces re-evaluation as time passes.
  const getLastSavedLabel = (savedAt: unknown, _tick: number) => {
    if (!savedAt) return "Autosaves as you type";
    const m = moment(savedAt as string);
    // Go marshals a zero time as year 1; treat anything pre-1972 as unset.
    if (!m.isValid() || m.year() <= 1971) return "Autosaves as you type";
    return `Last saved ${m.fromNow()}`;
  };
  $: lastSavedAt =
    $lastSavedStore[connection.connectionDetails.id] ??
    connection.connectionDetails.updatedAt;
  $: lastSavedLabel = getLastSavedLabel(lastSavedAt, now);
  $: footerLabel = $connectionIsValid
    ? lastSavedLabel
    : "Not saved, check the highlighted fields";
</script>

<!--
  Re-hosts the former connection-details page inside a dialog. The forms
  still auto-save each valid field change (Felte); the pinned footer makes
  that visible with a "last saved" label, and Save simply closes the dialog
  since everything is already persisted (it disables while a field is
  invalid, because invalid edits are never saved). Fields disable themselves
  while the connection is connected (handled inside ConnectionForm, which
  also owns the section heading + options menu).
-->
<Dialog {isOpen} startEmpty let:meltTitle>
  <div class="flex flex-col w-[550px] max-w-[78vw] max-h-[78vh]">
    <div
      class="flex items-center justify-between px-6 pt-5 pb-4 shrink-0 border-b border-divider/40"
    >
      <span class="text-lg" use:melt={meltTitle}>Connection settings</span>
      <IconButton onClick={() => isOpen.set(false)}>
        <Icon type="close" size={16} />
      </IconButton>
    </div>
    <div class="grow min-h-0 overflow-y-auto overflow-x-hidden px-6 pb-6 pt-4">
      <div class="flex flex-col gap-6">
        <ConnectionForm {connection} />
        <SubscriptionsForm {connection} />
      </div>
    </div>
    <div
      class="flex items-center justify-between px-6 py-4 shrink-0 border-t border-divider/40"
    >
      <span class="text-sm text-secondary-text">{footerLabel}</span>
      <Button
        variant="primary"
        disabled={!$connectionIsValid}
        on:click={() => isOpen.set(false)}>Save</Button
      >
    </div>
  </div>
</Dialog>
