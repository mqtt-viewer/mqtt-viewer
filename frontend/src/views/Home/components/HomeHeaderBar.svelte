<script lang="ts">
  import PageHeaderBar from "@/components/PageHeaderBar/PageHeaderBar.svelte";
  import connections from "@/stores/connections";
  import Icon from "@/components/Icon/Icon.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { untypedColors } from "@/util/resolvedTailwindConfig";

  let className = "";
  export { className as class };

  export let search = "";
  export let onAddGroup: () => void = () => {};

  const fieldColor = untypedColors["outline"]["DEFAULT"];
  const fieldHoverColor = "var(--color-hovered)";
</script>

<PageHeaderBar>
  <div class="relative size-full flex items-center justify-center">
    <span class="font-semibold">Connections</span>
    <div class="absolute top-1/2 -translate-y-1/2 left-5 w-[260px]">
      <BaseInput
        name="search-home-connections"
        placeholder="Search connections"
        icon="search"
        bgColor={fieldColor}
        bgHoverColor={fieldHoverColor}
        bind:value={search}
      />
    </div>
    <div
      class="absolute top-1/2 -translate-y-1/2 right-5 flex items-center gap-2"
    >
      <Button class="flex items-center gap-2" on:click={onAddGroup}
        ><Icon type="plus" />Group
      </Button>
      <Button
        class="flex items-center gap-2"
        on:click={() => connections.addConnection()}
        ><Icon type="plus" />Add Connection
      </Button>
    </div>
  </div>
</PageHeaderBar>
