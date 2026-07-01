<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";

  export let style: "line" | "area" = "line";
  export let showPoints = true;
  export let windowMinutes = 0;

  const windowOptions: { label: string; value: number }[] = [
    { label: "All history", value: 0 },
    { label: "Last 5 min", value: 5 },
    { label: "Last 15 min", value: 15 },
    { label: "Last 60 min", value: 60 },
  ];
  $: windowLabel =
    windowOptions.find((o) => o.value === windowMinutes)?.label ?? "All history";
</script>

<DropdownMenu placement="bottom-end">
  <div slot="trigger">
    <IconButton tooltipText="Chart options">
      <Icon type="settings" size={16} />
    </IconButton>
  </div>
  <div slot="menu-content" class="flex flex-col gap-3 p-2 min-w-[200px]">
    <div>
      <div class="text-sm text-secondary-text mb-1">X axis</div>
      <div class="text-base text-emphasis">Arrival time</div>
    </div>

    <div>
      <div class="text-sm text-secondary-text mb-1">Time window</div>
      <div class="flex flex-col">
        {#each windowOptions as option (option.value)}
          <DropdownMenuItem
            isSelected={windowMinutes === option.value}
            onClick={() => (windowMinutes = option.value)}
            >{option.label}</DropdownMenuItem
          >
        {/each}
      </div>
    </div>

    <div>
      <div class="text-sm text-secondary-text mb-1">Style</div>
      <div class="flex flex-col">
        <DropdownMenuItem
          isSelected={style === "line"}
          onClick={() => (style = "line")}>Line</DropdownMenuItem
        >
        <DropdownMenuItem
          isSelected={style === "area"}
          onClick={() => (style = "area")}>Area</DropdownMenuItem
        >
      </div>
    </div>

    <Switch
      name="ShowPoints"
      label="Show points"
      defaultChecked={showPoints}
      onChange={(checked) => (showPoints = checked)}
    />
  </div>
</DropdownMenu>

<span class="sr-only">{windowLabel}</span>
