<script lang="ts">
  import HomeGroupSection from "./components/HomeGroupSection/HomeGroupSection.svelte";
  import HomeHeaderBar from "./components/HomeHeaderBar.svelte";

  import connectionsStore from "@/stores/connections";
  import connectionGroups from "@/stores/connection-groups";
  import Button from "@/components/Button/Button.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { buildHomeSections } from "./helpers/sections";

  let search = "";
  let renamingGroupId: number | null = null;
  // Set by drag and drop (wired up separately).
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

  const run = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      addToast({
        data: { title, description: e as string, type: "error" },
      });
    }
  };

  const addGroup = () =>
    run("Failed to create group", async () => {
      const created = await connectionGroups.create("New group");
      renamingGroupId = created.id;
    });

  const renameGroup = (id: number, name: string) =>
    run("Failed to rename group", () => connectionGroups.rename(id, name));

  const deleteGroup = (id: number) =>
    run("Failed to delete group", () => connectionGroups.remove(id));

  // Searching opens every section without touching the saved fold state.
  const toggleGroup = (id: number, collapsed: boolean) =>
    isSearching
      ? undefined
      : run("Failed to update group", () =>
          connectionGroups.setCollapsed(id, collapsed)
        );
</script>

<div class="h-full w-full flex flex-col">
  <HomeHeaderBar bind:search onAddGroup={addGroup} />
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
    <div class="flex-grow h-0 overflow-auto scrollbar bg-elevation-1 py-4">
      {#each sections as section (section.group?.id ?? "ungrouped")}
        {@const group = section.group}
        <HomeGroupSection
          {section}
          {search}
          {isSearching}
          isRenaming={group !== null && renamingGroupId === group.id}
          isDropTarget={dropTarget === (group?.id ?? "ungrouped")}
          onToggle={() => group && toggleGroup(group.id, !group.collapsed)}
          onRename={(name) => group && renameGroup(group.id, name)}
          onRenameEnd={() => (renamingGroupId = null)}
          onDelete={() => group && deleteGroup(group.id)}
        />
      {/each}
      {#if isSearching && sections.length === 0}
        <div class="px-4 text-secondary-text">No matching connections</div>
      {/if}
    </div>
  {/if}
</div>
