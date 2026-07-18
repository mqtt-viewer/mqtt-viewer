<script lang="ts">
  import { onMount } from "svelte";
  import { get, writable } from "svelte/store";
  import { twMerge } from "tailwind-merge";
  import { GetMatchingProtoTypeForTopic } from "bindings/mqtt-viewer/backend/app/app";
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import connections, { type Connection } from "@/stores/connections";
  import protoState from "@/stores/proto-state";
  import Switch from "@/components/InputFields/Switch.svelte";
  import FilePathPicker from "@/components/InputFields/FilePathPicker.svelte";
  import ProtoBindingRulesForm, {
    type ProtoBindingMatchView,
  } from "@/components/ProtoBindingRulesForm/ProtoBindingRulesForm.svelte";

  export let connection: Connection;

  $: connectionId = connection.connectionDetails.id;
  $: isConnected = connection.connectionState !== "disconnected";
  $: protoRegDir = connection.connectionDetails.protoRegDir ?? "";

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

  // Two distinct "no types available" reasons, kept separate: noDirConfigured
  // is a purely frontend-derived fact (no dir set at all, drives the empty
  // bindings-list copy); folderNotFound is backend-sourced (a dir IS
  // configured but wasn't found on disk when last loaded, drives the status
  // line and suppresses the stale-type warning).
  $: noDirConfigured = !protoRegDir;
  $: folderNotFound = !!protoStateForConnection?.dirMissing;
  $: zeroTypes = !noDirConfigured && !loadError && typeCount === 0;

  $: isCompileError = !!loadError && !folderNotFound;

  // The status line only reflects protoStateForConnection once it's actually
  // for the currently-configured dir, so a stale compile result (or missing
  // state entirely) never flashes as if it described protoRegDir.
  $: isStateFresh =
    !!protoStateForConnection && protoStateForConnection.dir === protoRegDir;

  $: statusLineText = !protoRegDir
    ? ""
    : !isStateFresh
      ? "Loading types..."
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

  onMount(async () => {
    protoState.ensureConnection(connectionId, connection.eventSet);
    await protoState.refresh(connectionId);
    // Registry load triggers: dir configured but never compiled this
    // session (or compiled from a now-stale dir) gets a fresh compile when
    // the form opens, same as a manual reload.
    const current = get(protoState).byConnectionId[connectionId];
    if (protoRegDir && current?.dir !== protoRegDir) {
      try {
        await protoState.loadRegistry(connectionId);
      } catch (e) {
        console.error(e);
      }
    }
  });

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

  const onDirChosen = async (filePath: string) => {
    try {
      await connections.updateConnectionDetails({
        ...connection.connectionDetails,
        protoRegDir: filePath,
      });
      await protoState.loadRegistry(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  const onDirCleared = async () => {
    try {
      await connections.updateConnectionDetails({
        ...connection.connectionDetails,
        protoRegDir: "",
      });
      await protoState.loadRegistry(connectionId);
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

<div class="flex flex-col gap-4">
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
    <div class="flex flex-col gap-1">
      <FilePathPicker
        variant="directory"
        actionLabel="Choose .proto folder"
        valueLabel="Proto folder"
        defaultValue={protoRegDir || undefined}
        onFileChosen={onDirChosen}
        onFileRemoved={onDirCleared}
      />
      {#if statusLineText}
        <div
          class={twMerge(
            "text-sm",
            loadError && isStateFresh ? "text-error" : "text-secondary-text",
            isCompileError && isStateFresh ? "line-clamp-3" : ""
          )}
          title={isCompileError && isStateFresh ? statusLineText : undefined}
        >
          {statusLineText}
        </div>
      {/if}
    </div>

    <ProtoBindingRulesForm
      {rules}
      {descriptorNames}
      status={{
        fileCount,
        typeCount,
        loadError,
        dirMissing: noDirConfigured,
        folderNotFound,
        zeroTypes,
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
