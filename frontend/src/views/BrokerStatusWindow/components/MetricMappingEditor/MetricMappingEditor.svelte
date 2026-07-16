<script lang="ts">
  // Per-connection metric-tile mapping editor for the Broker Status window.
  // Lists the connection's SysMetricMapping rows and edits them through the
  // CRUD bindings, then asks the store to reload so tiles update live. Opens
  // either blank (the grid's "+" tile) or prefilled with a topic/label (the
  // raw browser's "pin as tile" button).
  import { writable, type Writable } from "svelte/store";
  import type { SelectOption } from "@melt-ui/svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Select from "@/components/InputFields/Select.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import * as models from "bindings/mqtt-viewer/backend/models/models";
  import {
    AddSysMetricMapping,
    UpdateSysMetricMapping,
    DeleteSysMetricMapping,
    GetSysMetricMappingsByConnectionId,
  } from "bindings/mqtt-viewer/backend/app/app";
  import { BUILTIN_METRICS } from "../../sys-metrics";
  import type { BrokerStatusStore } from "../../broker-status-store";

  export let connectionId: number;
  export let store: BrokerStatusStore;
  export let isOpen: Writable<boolean> = writable(false);
  /** When opening in add mode, seed the draft topic/label (pin-from-browser). */
  export let prefill: { topic?: string; label?: string } | null = null;

  const NONE_LABEL = "None — custom tile";
  // Sentinel option value for "no override". The Select treats an empty-string
  // value as "nothing selected" and keeps its floating label at rest, which
  // then overlaps the trigger text; a non-empty sentinel makes the label float
  // up like every other field. Mapped back to "" (the stored metricKey) below.
  const NONE_VALUE = "__none__";
  const toMetricKey = (value: string): string =>
    value === NONE_VALUE ? "" : value;
  const toOptionValue = (metricKey: string): string =>
    metricKey === "" ? NONE_VALUE : metricKey;

  // Overridable builtins only — the computed observed_* tiles have no topic to
  // redirect, so they are not offered as override targets.
  const overrideTargets = BUILTIN_METRICS.filter((m) => !m.computed);
  const overrideOptions: string[] = [
    NONE_VALUE,
    ...overrideTargets.map((m) => m.key),
  ];
  const labelFor = (value: string): string =>
    value === NONE_VALUE || value === ""
      ? NONE_LABEL
      : (overrideTargets.find((m) => m.key === value)?.label ?? value);

  interface Draft {
    id: number | null;
    metricKey: string;
    label: string;
    topic: string;
    payloadPath: string;
    unit: string;
    sortOrder: number;
  }

  const blankDraft = (seed: { topic?: string; label?: string } | null): Draft => ({
    id: null,
    metricKey: "",
    label: seed?.label ?? "",
    topic: seed?.topic ?? "",
    payloadPath: "",
    unit: "",
    sortOrder: 0,
  });

  let rows: models.SysMetricMapping[] = [];
  let draft: Draft = blankDraft(null);
  let topicError: string | undefined = undefined;
  let saving = false;

  const overrideSelected = writable<SelectOption<string | undefined>>({
    value: NONE_VALUE,
    label: NONE_LABEL,
  });

  const setDraft = (next: Draft) => {
    draft = next;
    topicError = undefined;
    const optionValue = toOptionValue(next.metricKey);
    overrideSelected.set({ value: optionValue, label: labelFor(optionValue) });
  };

  const refresh = async () => {
    rows = (await GetSysMetricMappingsByConnectionId(connectionId)) ?? [];
  };

  const nextSortOrder = (): number =>
    rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

  const onOverrideChange = (value: string | undefined) => {
    draft.metricKey = toMetricKey(value ?? NONE_VALUE);
  };

  const editRow = (row: models.SysMetricMapping) =>
    setDraft({
      id: row.id,
      metricKey: row.metricKey,
      label: row.label,
      topic: row.topic,
      payloadPath: row.payloadPath,
      unit: row.unit,
      sortOrder: row.sortOrder,
    });

  const cancelEdit = () => setDraft(blankDraft(null));

  const save = async () => {
    if (draft.topic.trim() === "") {
      topicError = "Topic is required";
      return;
    }
    saving = true;
    try {
      const mapping = new models.SysMetricMapping({
        id: draft.id ?? 0,
        connectionId,
        metricKey: draft.metricKey,
        label: draft.label.trim(),
        topic: draft.topic.trim(),
        payloadPath: draft.payloadPath.trim(),
        unit: draft.unit.trim(),
        sortOrder: draft.id !== null ? draft.sortOrder : nextSortOrder(),
      });
      if (draft.id !== null) {
        await UpdateSysMetricMapping(connectionId, mapping);
      } else {
        await AddSysMetricMapping(connectionId, mapping);
      }
      await refresh();
      await store.reloadMappings();
      setDraft(blankDraft(null));
    } catch (e) {
      console.error("Failed to save metric mapping", e);
      addToast({
        data: {
          title: "Metric tile",
          description: "Could not save the mapping",
          type: "error",
        },
      });
    } finally {
      saving = false;
    }
  };

  const remove = async (row: models.SysMetricMapping) => {
    try {
      await DeleteSysMetricMapping(connectionId, row.id);
      if (draft.id === row.id) setDraft(blankDraft(null));
      await refresh();
      await store.reloadMappings();
    } catch (e) {
      console.error("Failed to delete metric mapping", e);
      addToast({
        data: {
          title: "Metric tile",
          description: "Could not delete the mapping",
          type: "error",
        },
      });
    }
  };

  // Re-load rows and reset the draft each time the dialog opens.
  let wasOpen = false;
  $: if ($isOpen && !wasOpen) {
    wasOpen = true;
    void refresh();
    setDraft(blankDraft(prefill));
  } else if (!$isOpen && wasOpen) {
    wasOpen = false;
  }

  $: editing = draft.id !== null;
</script>

<Dialog
  {isOpen}
  title="Metric tiles"
  description="Redirect a builtin tile to your broker's topics, or add your own custom tiles. Changes apply to this connection."
>
  <div class="flex w-[520px] max-w-[86vw] flex-col gap-5">
    <!-- Draft form: add mode, or edit when a row was picked. -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-3 sm:flex-row">
        <BaseInput
          name="mapping-label"
          label="Label"
          placeholder="Connected clients"
          bind:value={draft.label}
        />
        <Select
          label="Overrides"
          options={overrideOptions}
          getOptionLabel={labelFor}
          selected={overrideSelected}
          onChange={onOverrideChange}
          sameWidth
        />
      </div>
      <BaseInput
        name="mapping-topic"
        label="Topic"
        placeholder="$SYS/broker/clients/connected"
        bind:value={draft.topic}
        errorMessage={topicError}
        onChange={() => (topicError = undefined)}
      />
      <div class="flex flex-col gap-3 sm:flex-row">
        <BaseInput
          name="mapping-path"
          label="JSON path (optional)"
          placeholder="data.temp"
          bind:value={draft.payloadPath}
        />
        <BaseInput
          name="mapping-unit"
          label="Unit (optional)"
          placeholder="°C"
          bind:value={draft.unit}
        />
      </div>
      <div class="flex items-center justify-end gap-3">
        {#if editing}
          <Button variant="text" on:click={cancelEdit}>Cancel edit</Button>
        {/if}
        <Button variant="primary" disabled={saving} on:click={save}>
          {saving ? "Saving…" : editing ? "Save changes" : "Add tile"}
        </Button>
      </div>
    </div>

    <div class="h-px w-full bg-divider"></div>

    <!-- Existing mappings for this connection. -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-secondary-text">
        {rows.length === 0
          ? "No custom mappings yet"
          : `Mappings (${rows.length})`}
      </span>
      <div class="flex max-h-[240px] flex-col gap-1 overflow-auto">
        {#each rows as row (row.id)}
          <div
            class="flex items-center gap-2 rounded border border-outline bg-elevation-0 px-3 py-2"
          >
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-emphasis">
                {row.label !== "" ? row.label : row.topic}
                {#if row.metricKey !== ""}
                  <span class="text-secondary-text">
                    → {labelFor(row.metricKey)}</span
                  >
                {/if}
              </span>
              <span class="truncate text-sm text-secondary-text">
                {row.topic}{row.payloadPath !== ""
                  ? ` · ${row.payloadPath}`
                  : ""}{row.unit !== "" ? ` · ${row.unit}` : ""}
              </span>
            </div>
            <div class="ml-auto flex shrink-0 items-center">
              <IconButton tooltipText="Edit" onClick={() => editRow(row)}>
                <Icon type="edit" size={16} />
              </IconButton>
              <IconButton
                tooltipText="Delete"
                class="text-error enabled:hover:text-error-light"
                onClick={() => remove(row)}
              >
                <Icon type="delete" size={16} />
              </IconButton>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</Dialog>
