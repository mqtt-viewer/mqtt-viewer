<script lang="ts">
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import BigAddConnectionButton from "./components/BigAddConnectionButton.svelte";
  import RecentConnectionsList from "./components/RecentConnectionsList/RecentConnectionsList.svelte";
  import connections from "@/stores/connections";
  import { filterConnections } from "./helpers/filter";
  import { untypedColors } from "@/util/resolvedTailwindConfig";

  let searchString = "";

  $: filteredConnections = filterConnections(
    Object.values($connections.connections),
    searchString
  );

  const onAddNewClick = async () => {
    await connections.addConnection();
  };

  const fieldColor = untypedColors["outline"]["DEFAULT"];
  const fieldHoverColor = untypedColors["hovered"]["DEFAULT"];
</script>

<div class="w-full h-full flex justify-center overflow-y-auto bg-elevation-1">
  <div class="min-w-[500px] w-1/3 max-w-[800px] h-fit flex flex-col pt-32">
    <div class="sticky top-0 w-full bg-elevation-1 z-10">
      <BigAddConnectionButton class="mt-6 mb-4" onClick={onAddNewClick} />
      <BaseInput
        name="search-connections"
        placeholder="Search connections"
        icon="search"
        bgColor={fieldColor}
        bgHoverColor={fieldHoverColor}
        bind:value={searchString}
      />
      <div class="mt-4 mb-1 w-full flex">
        <span class="text">Recent Connections</span>
      </div>
    </div>

    <RecentConnectionsList class="mt-1" connections={filteredConnections} />
  </div>
</div>
