<script lang="ts">
  import HomeGroupSection from "./components/HomeGroupSection/HomeGroupSection.svelte";
  import HomeHeaderBar from "./components/HomeHeaderBar.svelte";

  import connectionsStore from "@/stores/connections";
  import connectionGroups from "@/stores/connection-groups";
  import Button from "@/components/Button/Button.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import {
    buildHomeSections,
    splitDropZone,
    ungroupedLabel,
  } from "./helpers/sections";
  import { errorMessage } from "@/util/strings";
  import type { GroupDrop } from "./dnd/resolve-group-drop";

  let search = "";
  let renamingGroupId: number | null = null;
  // Set while a card is being dragged.
  let draggingConnectionId: number | null = null;
  let dropTarget: number | "ungrouped" | null = null;

  $: connections = Object.keys($connectionsStore.connections ?? {}).map(
    (key) => $connectionsStore.connections[parseInt(key)]
  );

  $: isSearching = search.trim() !== "";
  $: sections = buildHomeSections({
    connections,
    groups: $connectionGroups,
    search,
    isDragging: draggingConnectionId !== null,
  });

  $: label = ungroupedLabel($connectionGroups);
  $: ({ zone, rest } = splitDropZone(sections));

  const run = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      addToast({
        data: { title, description: errorMessage(e), type: "error" },
      });
    }
  };

  const addGroup = () =>
    run("Failed to create group", async () => {
      // A new group has no matches, so it would stay hidden mid-search.
      search = "";
      const created = await connectionGroups.create("New group");
      renamingGroupId = created.id;
    });

  const renameGroup = (id: number, name: string) =>
    run("Failed to rename group", () => connectionGroups.rename(id, name));

  const deleteGroup = (id: number) =>
    run("Failed to delete group", () => connectionGroups.remove(id));

  const onCardHover = (drop: GroupDrop | null) =>
    (dropTarget = drop === null ? null : (drop.groupId ?? "ungrouped"));

  // Also the end of every cancelled drag (drop is null then).
  const onCardDrop = (drop: GroupDrop | null, connectionId: number) => {
    const current =
      $connectionsStore.connections?.[connectionId]?.connectionDetails.groupId ??
      null;
    draggingConnectionId = null;
    dropTarget = null;
    if (drop === null || drop.groupId === current) return;
    run("Failed to move connection", () =>
      connectionGroups.assign(connectionId, drop.groupId)
    );
  };

  // Searching opens every section without touching the saved fold state.
  const toggleGroup = (id: number, collapsed: boolean) =>
    isSearching
      ? undefined
      : run("Failed to update group", () =>
          connectionGroups.setCollapsed(id, collapsed)
        );
</script>

<div class="h-full w-full flex flex-col">
  <div class="relative">
    <HomeHeaderBar bind:search onAddGroup={addGroup} />
    {#if zone}
      <!-- Drag-time Ungrouped drop zone: covers the header bar, which holds no
           drop targets, so it never shifts or hides a section. -->
      <div class="absolute inset-0 z-20 bg-elevation-2">
        <HomeGroupSection
          section={zone}
          isDropZone
          ungroupedLabel={label}
          isDropTarget={dropTarget === "ungrouped"}
        />
      </div>
    {/if}
  </div>
  {#if connections.length === 0}
    <div
      class="bg-elevation-1 flex-grow flex flex-col items-center justify-center"
    >
      <div class="mb-4 text-secondary-text">Nothing to see here... yet</div>
      <div>
        <Button
          variant="secondary"
          iconType="plus"
          iconSize={16}
          on:click={() => connectionsStore.addConnection()}
          >Add Connection</Button
        >
      </div>
    </div>
  {:else}
    <div class="flex-grow h-0 relative">
      <div class="h-full overflow-auto scrollbar bg-elevation-1 py-4">
        {#each rest as section (section.group?.id ?? "ungrouped")}
          {@const group = section.group}
          <HomeGroupSection
            {section}
            ungroupedLabel={label}
            {search}
            {isSearching}
            isRenaming={group !== null && renamingGroupId === group.id}
            isDropTarget={dropTarget === (group?.id ?? "ungrouped")}
            onToggle={() => group && toggleGroup(group.id, !group.collapsed)}
            onRename={(name) => group && renameGroup(group.id, name)}
            onRenameEnd={() => (renamingGroupId = null)}
            onDelete={() => group && deleteGroup(group.id)}
            onCardDragStart={(id) => (draggingConnectionId = id)}
            {onCardHover}
            {onCardDrop}
          />
        {/each}
        {#if isSearching && rest.length === 0 && !zone}
          <div class="px-4 text-secondary-text">No matching connections</div>
        {/if}
      </div>
    </div>
  {/if}
</div>
