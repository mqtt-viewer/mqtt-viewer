<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { twMerge } from "tailwind-merge";
  import {
    ChooseDirectory,
    GetMatchingProtoTypeForTopic,
  } from "bindings/mqtt-viewer/backend/app/app";
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import connections, { type Connection } from "@/stores/connections";
  import protoState from "@/stores/proto-state";
  import Switch from "@/components/InputFields/Switch.svelte";
  import Button from "@/components/Button/Button.svelte";
  import ProtoBindingRulesForm, {
    type ProtoBindingMatchView,
  } from "@/components/ProtoBindingRulesForm/ProtoBindingRulesForm.svelte";

  export let connection: Connection;

  $: connectionId = connection.connectionDetails.id;
  $: isConnected = connection.connectionState !== "disconnected";

  // Controlled from the connections store (via connections.updateConnectionDetails,
  // which is now optimistic-with-revert, see F5) rather than a mount-time-seeded
  // local `let`: this section remounts fresh every time the details dialog
  // opens, so a store-backed writable keeps the Switch's visual state and the
  // rest of this section's derived state in sync with the source of truth
  // instead of drifting from it.
  const protoEnabledChecked = writable(
    !!connection.connectionDetails.isProtoEnabled
  );
  $: protoEnabledChecked.set(!!connection.connectionDetails.isProtoEnabled);
  $: currentProtoEnabled = !!connection.connectionDetails.isProtoEnabled;

  $: protoStateForConnection = $protoState.byConnectionId[connectionId];
  $: rules = protoStateForConnection?.rules ?? [];
  $: descriptorNames = protoStateForConnection?.descriptorNames ?? [];
  $: fileCount = protoStateForConnection
    ? Object.keys(protoStateForConnection.fileDescriptors ?? {}).length
    : 0;
  $: typeCount = descriptorNames.length;
  $: loadError = protoStateForConnection?.loadError ?? "";
  $: sourceDir = protoStateForConnection?.sourceDir ?? "";

  // Something has been imported once the internal proto-imports dir exists
  // on disk, whether or not it's been compiled into protoState yet (or
  // compiled at all — an empty or failed compile still counts: there's
  // something to show status for, re-import, or remove). Backed by a plain
  // os.Stat rather than a compiled dir/typeCount, so a fresh app launch
  // doesn't flash the "not imported" empty state for the split second
  // before the lazy compile below finishes.
  $: imported = !!protoStateForConnection?.hasImport;

  // folderNotFound: the internal import existed a moment ago and has since
  // vanished from disk (backend-sourced). isCompileError: a real compile
  // failure against files that are still there.
  $: folderNotFound = !!protoStateForConnection?.dirMissing;
  $: isCompileError = !!loadError && !folderNotFound;

  // busy covers the initial mount compile and every import/re-import action;
  // it disables the action buttons and (once something is already imported)
  // drives the "Loading types..." status line.
  let busy = false;

  // The "Loading types..." line only appears once a compile has taken a
  // moment: it's usually near-instant, so showing it immediately just
  // flashes it on every open or click.
  const LOADING_LINE_DELAY_MS = 200;
  let showLoadingLine = false;
  let loadingLineTimeout: ReturnType<typeof setTimeout> | null = null;

  $: if (imported && busy) {
    if (!loadingLineTimeout) {
      loadingLineTimeout = setTimeout(() => {
        showLoadingLine = true;
        loadingLineTimeout = null;
      }, LOADING_LINE_DELAY_MS);
    }
  } else {
    if (loadingLineTimeout) {
      clearTimeout(loadingLineTimeout);
      loadingLineTimeout = null;
    }
    showLoadingLine = false;
  }

  onDestroy(() => {
    if (loadingLineTimeout) clearTimeout(loadingLineTimeout);
  });

  $: statusLineText = !imported
    ? ""
    : busy
      ? showLoadingLine
        ? "Loading types..."
        : ""
      : folderNotFound
        ? "Folder not found. Choose it again."
        : isCompileError
          ? `Failed to compile: ${loadError}`
          : typeCount === 0
            ? "No message types found in this folder."
            : `${fileCount} file${fileCount === 1 ? "" : "s"}, ${typeCount} message type${typeCount === 1 ? "" : "s"}`;

  $: switchSubLine = isConnected && !currentProtoEnabled
    ? "Disconnect to turn this on."
    : currentProtoEnabled
      ? "Sparkplug topics decode without any setup."
      : null;

  // Most recent import/re-import action's failure, shown separately from
  // statusLineText (which describes the last successful compile, not the
  // action that just failed).
  let importActionError = "";

  const errorMessage = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

  onMount(async () => {
    protoState.ensureConnection(connectionId, connection.eventSet);
    await protoState.refresh(connectionId);
    // Compiles the internal proto import dir if it hasn't been compiled yet
    // this session (e.g. the app just started, or this is the first time the
    // dialog has been opened for this connection).
    busy = true;
    try {
      await protoState.loadRegistry(connectionId);
    } catch (e) {
      console.error(e);
    } finally {
      busy = false;
    }
  });

  const onChooseFolder = async () => {
    if (busy) return;
    try {
      const dir = await ChooseDirectory("Choose .proto folder");
      // A cancelled picker resolves with an empty string.
      if (!dir) return;
      importActionError = "";
      busy = true;
      await protoState.importDir(connectionId, dir);
    } catch (e) {
      console.error(e);
      importActionError = errorMessage(e);
    } finally {
      busy = false;
    }
  };

  let fileInputEl: HTMLInputElement | undefined;

  const onChooseFiles = () => {
    if (busy) return;
    fileInputEl?.click();
  };

  const onFilesSelected = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    try {
      const files = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          // webkitRelativePath preserves a folder-shaped selection's
          // subpaths (e.g. "common/types.proto"), falling back to the bare
          // file name for a flat multi-file selection.
          name: file.webkitRelativePath || file.name,
          content: await file.text(),
        }))
      );
      importActionError = "";
      busy = true;
      await protoState.importFiles(connectionId, files);
    } catch (e) {
      console.error(e);
      importActionError = errorMessage(e);
    } finally {
      busy = false;
      input.value = "";
    }
  };

  const onReimport = async () => {
    if (busy) return;
    try {
      importActionError = "";
      busy = true;
      await protoState.reimport(connectionId);
    } catch (e) {
      console.error(e);
      importActionError = errorMessage(e);
    } finally {
      busy = false;
    }
  };

  const onRemove = async () => {
    try {
      importActionError = "";
      await protoState.clearImport(connectionId);
    } catch (e) {
      console.error(e);
      importActionError = errorMessage(e);
    }
  };

  const onToggleProtoEnabled = async (checked: boolean) => {
    try {
      await connections.updateConnectionDetails({
        ...connection.connectionDetails,
        isProtoEnabled: checked,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const onAddRule = async (rule: { topicFilter: string; messageType: string }) => {
    await protoState.addRule(connectionId, rule);
  };

  const onUpdateRule = async (
    id: number,
    changes: { topicFilter?: string; messageType?: string }
  ) => {
    const existing = rules.find((r) => r.id === id);
    if (!existing) return;
    try {
      await protoState.updateRule(connectionId, {
        ...existing,
        ...changes,
      } as models.ProtoBindingRule);
    } catch (e) {
      console.error(e);
    }
  };

  const onDeleteRule = async (id: number) => {
    try {
      await protoState.deleteRule(connectionId, id);
    } catch (e) {
      console.error(e);
    }
  };

  const onMoveRule = async (id: number, direction: "up" | "down") => {
    const index = rules.findIndex((r) => r.id === id);
    if (index === -1) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rules.length) return;
    const orderedIds = rules.map((r) => r.id);
    [orderedIds[index], orderedIds[swapWith]] = [
      orderedIds[swapWith],
      orderedIds[index],
    ];
    try {
      await protoState.reorderRules(connectionId, orderedIds);
    } catch (e) {
      console.error(e);
    }
  };

  const onTestTopic = async (
    topic: string
  ): Promise<ProtoBindingMatchView | null> => {
    const match = await GetMatchingProtoTypeForTopic(connectionId, topic);
    if (!match?.Source) return null;
    return {
      filter: match.Filter,
      messageType: match.MessageType,
      source: match.Source as "rule" | "sparkplug",
    };
  };
</script>

<div class="flex flex-col gap-6">
  <span class="text-lg w-full">Protobuf</span>

  <div class="flex flex-col gap-2">
    <Switch
      disabled={isConnected}
      onChange={onToggleProtoEnabled}
      name="isProtoEnabled"
      label="Decode and encode Protobuf and Sparkplug messages"
      defaultChecked={currentProtoEnabled}
      checked={protoEnabledChecked}
    />
    {#if switchSubLine}
      <div class="text-secondary-text text-sm">{switchSubLine}</div>
    {/if}
  </div>

  {#if currentProtoEnabled}
    <div class="flex flex-col gap-2">
      {#if !imported}
        <div class="flex items-center gap-4">
          <Button
            variant="primary"
            iconType="folder"
            disabled={busy}
            on:click={onChooseFolder}
          >
            Choose .proto folder
          </Button>
          <Button variant="text" disabled={busy} on:click={onChooseFiles}>
            or import .proto files
          </Button>
        </div>
      {:else}
        {#if statusLineText}
          <div
            class={twMerge(
              "text-sm",
              loadError && !busy ? "text-error" : "text-secondary-text",
              isCompileError && !busy ? "line-clamp-3" : ""
            )}
            title={isCompileError && !busy ? statusLineText : undefined}
          >
            {statusLineText}
          </div>
        {/if}
        {#if sourceDir}
          <div class="text-secondary-text text-sm truncate" style:direction="rtl" title={sourceDir}>
            <bdi>Imported from {sourceDir}</bdi>
          </div>
        {/if}
        <div class="flex items-center gap-4">
          {#if sourceDir}
            <Button variant="text" disabled={busy} on:click={onReimport}>
              Re-import
            </Button>
          {/if}
          <Button variant="text" disabled={busy} on:click={onRemove}>
            Remove
          </Button>
        </div>
      {/if}
      <input
        bind:this={fileInputEl}
        type="file"
        multiple
        accept=".proto"
        class="hidden"
        on:change={onFilesSelected}
      />
      {#if importActionError}
        <div class="text-error text-sm">{importActionError}</div>
      {/if}
    </div>

    <ProtoBindingRulesForm
      {rules}
      {descriptorNames}
      status={{
        loadError,
        dirMissing: !imported,
        folderNotFound,
      }}
      connected={isConnected}
      onAdd={onAddRule}
      onUpdate={onUpdateRule}
      onDelete={onDeleteRule}
      onMove={onMoveRule}
      {onTestTopic}
    />
  {/if}
</div>
