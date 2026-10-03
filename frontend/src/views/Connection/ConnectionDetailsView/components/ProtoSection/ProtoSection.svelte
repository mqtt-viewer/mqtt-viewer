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
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import ProtoBindingRulesForm, {
    type ProtoBindingMatchView,
  } from "@/components/ProtoBindingRulesForm/ProtoBindingRulesForm.svelte";
  import envStore from "@/stores/env";
  import { errorMessage } from "@/util/strings";

  export let connection: Connection;
  // Overrides the env store's server-mode flag, so a story can render the
  // browser (web UI) folder picker. Leave unset in the app.
  export let serverMode: boolean | undefined = undefined;

  // The web UI has no native folder dialog (ChooseDirectory returns "" in
  // server mode), so folder imports go through a directory file input.
  $: isServerMode = serverMode ?? $envStore.isServerMode;

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
            ? "No message types in the imported files."
            : `${fileCount} file${fileCount === 1 ? "" : "s"}, ${typeCount} message type${typeCount === 1 ? "" : "s"}`;

  $: switchSubLine = isConnected && !currentProtoEnabled
    ? "Disconnect to turn this on."
    : currentProtoEnabled
      ? "Sparkplug topics decode without any setup."
      : null;

  // Most recent import/re-import/remove action's failure, shown separately
  // from statusLineText (which describes the last successful compile, not
  // the action that just failed). A failed import leaves any previous import
  // in place, so the lead line says whether one was kept; detail is the
  // backend's message (for a compile failure, the compile error).
  let importActionError: { lead: string; detail: string } | null = null;

  const setImportFailure = (e: unknown, hadImport: boolean) => {
    importActionError = {
      lead: hadImport
        ? "Import failed, so I kept the previous files."
        : "Import failed.",
      detail: errorMessage(e),
    };
  };

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

  // Used for both the first import and "Replace with folder". The native
  // app uses the OS folder dialog; the web UI opens a directory file input.
  const onChooseFolder = async () => {
    if (busy) return;
    if (isServerMode) {
      folderInputEl?.click();
      return;
    }
    const hadImport = imported;
    try {
      const dir = await ChooseDirectory("Choose .proto folder");
      // A cancelled picker resolves with an empty string.
      if (!dir) return;
      importActionError = null;
      busy = true;
      await protoState.importDir(connectionId, dir);
    } catch (e) {
      console.error(e);
      setImportFailure(e, hadImport);
    } finally {
      busy = false;
    }
  };

  // Flat multi-file selection ("or import .proto files", "Replace with
  // files"); the input's accept filter already limits it to .proto.
  let fileInputEl: HTMLInputElement | undefined;
  // Directory selection, web UI only (webkitdirectory).
  let folderInputEl: HTMLInputElement | undefined;

  const onChooseFiles = () => {
    if (busy) return;
    fileInputEl?.click();
  };

  // A directory input's webkitRelativePath starts with the chosen folder's
  // own name ("protos/common/units.proto"). Imports resolve relative to the
  // chosen folder, so drop that first segment ("common/units.proto") to keep
  // `import "common/units.proto"` working. A flat selection has no relative
  // path, so it falls back to the bare file name.
  const uploadPathFor = (file: File) => {
    const relative = file.webkitRelativePath;
    if (!relative) return file.name;
    const slash = relative.indexOf("/");
    return slash === -1 ? relative : relative.slice(slash + 1);
  };

  const importSelectedFiles = async (input: HTMLInputElement, onlyProto: boolean) => {
    const fileList = input.files;
    if (!fileList || fileList.length === 0) return;
    // Reading a large folder takes a while; a second pick in the meantime
    // must not start a second import.
    if (busy) {
      input.value = "";
      return;
    }
    const hadImport = imported;
    busy = true;
    try {
      // A directory input hands over every file in the folder, so keep only
      // the .proto ones there. The flat input sends what was picked as-is
      // and lets the backend reject a wrong name.
      const picked = Array.from(fileList).filter(
        (file) => !onlyProto || file.name.endsWith(".proto")
      );
      if (picked.length === 0) {
        importActionError = {
          lead: "That folder has no .proto files.",
          detail: "",
        };
        return;
      }
      const files = await Promise.all(
        picked.map(async (file) => ({
          name: uploadPathFor(file),
          content: await file.text(),
        }))
      );
      importActionError = null;
      await protoState.importFiles(connectionId, files);
    } catch (e) {
      console.error(e);
      setImportFailure(e, hadImport);
    } finally {
      busy = false;
      input.value = "";
    }
  };

  const onFilesSelected = (event: Event) =>
    importSelectedFiles(event.currentTarget as HTMLInputElement, false);

  const onFolderSelected = (event: Event) =>
    importSelectedFiles(event.currentTarget as HTMLInputElement, true);

  const onReimport = async () => {
    if (busy) return;
    const hadImport = imported;
    try {
      importActionError = null;
      busy = true;
      await protoState.reimport(connectionId);
    } catch (e) {
      console.error(e);
      setImportFailure(e, hadImport);
    } finally {
      busy = false;
    }
  };

  // Removing wipes the import and leaves every binding pointing at a type
  // that no longer loads, so it goes through a confirmation step (same
  // shape as ConfirmDeleteConnectionDialog, inlined here to avoid a
  // single-use component).
  const confirmRemoveOpen = writable(false);

  const onRemoveClicked = () => {
    if (busy) return;
    confirmRemoveOpen.set(true);
  };

  const onRemove = async () => {
    confirmRemoveOpen.set(false);
    try {
      importActionError = null;
      await protoState.clearImport(connectionId);
    } catch (e) {
      console.error(e);
      importActionError = {
        lead: "Could not remove the imported files.",
        detail: errorMessage(e),
      };
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

  // Rule writes let a failure propagate: ProtoBindingRulesForm catches it and
  // shows it inline (on the row, under the list, or under the draft) and
  // keeps the unsaved edit so a retry is possible. protoState already logs.
  const onAddRule = async (rule: { topicFilter: string; messageType: string }) => {
    await protoState.addRule(connectionId, rule);
  };

  const onUpdateRule = async (
    id: number,
    changes: { topicFilter?: string; messageType?: string }
  ) => {
    const existing = rules.find((r) => r.id === id);
    if (!existing) return;
    await protoState.updateRule(connectionId, {
      ...existing,
      ...changes,
    } as models.ProtoBindingRule);
  };

  const onDeleteRule = async (id: number) => {
    await protoState.deleteRule(connectionId, id);
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
    await protoState.reorderRules(connectionId, orderedIds);
  };

  const onTestTopic = async (
    topic: string
  ): Promise<ProtoBindingMatchView | null> => {
    const match = await GetMatchingProtoTypeForTopic(connectionId, topic);
    if (!match?.source) return null;
    return {
      filter: match.filter,
      messageType: match.messageType,
      source: match.source as "rule" | "sparkplug",
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
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          {#if sourceDir}
            <Button variant="text" disabled={busy} on:click={onReimport}>
              Re-import
            </Button>
          {/if}
          <Button variant="text" disabled={busy} on:click={onChooseFolder}>
            Replace with folder
          </Button>
          <Button variant="text" disabled={busy} on:click={onChooseFiles}>
            Replace with files
          </Button>
          <Button variant="text" disabled={busy} on:click={onRemoveClicked}>
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
        data-testid="proto-files-input"
        on:change={onFilesSelected}
      />
      <input
        bind:this={folderInputEl}
        type="file"
        webkitdirectory
        multiple
        class="hidden"
        data-testid="proto-folder-input"
        on:change={onFolderSelected}
      />
      {#if importActionError}
        <div class="text-error text-sm flex flex-col">
          <span>{importActionError.lead}</span>
          {#if importActionError.detail}
            <span class="line-clamp-3" title={importActionError.detail}
              >{importActionError.detail}</span
            >
          {/if}
        </div>
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

<Dialog
  isOpen={confirmRemoveOpen}
  title="Remove the imported .proto files?"
>
  <div class="flex flex-col gap-3 mt-3">
    <p>
      Your bindings stay. Sparkplug still decodes, but bound topics show raw
      payloads until you import again.
    </p>
    <div class="flex gap-3 justify-end items-center">
      <Button variant="text" on:click={() => confirmRemoveOpen.set(false)}>
        Cancel
      </Button>
      <Button
        iconType="delete"
        class="text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
        iconPlacement="left"
        iconSize={16}
        on:click={onRemove}>Remove</Button
      >
    </div>
  </div>
</Dialog>
