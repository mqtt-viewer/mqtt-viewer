<script lang="ts">
  import type { Weight } from "node_modules/phosphor-svelte/lib/shared";
  import { ICON_MAP, type IconType } from "./icons";

  export let type: IconType;
  export let size: number = 16;
  export let width: number = size;
  export let height: number = size;
  export let color = "currentColor" as string | undefined;
  export let weight = undefined as Weight | undefined;

  export let selected = false;

  const getIcon = (type: IconType) => {
    const Icon = ICON_MAP[type];
    if (!Icon) {
      throw new Error(`Icon type ${type} not found`);
    }
    return Icon;
  };

  $: Icon = getIcon(type);
</script>

<svelte:component
  this={Icon}
  {width}
  {height}
  {color}
  weight={selected ? "fill" : (weight ?? "regular")}
/>
