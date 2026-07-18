<script lang="ts">
  import { onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";

  export let style: "line" | "area" = "line";
  export let showPoints = true;
  export let windowSeconds = 0;
  // Called whenever the user changes the window via a preset click or a
  // custom-field edit -- never fired for an externally-seeded windowSeconds.
  // ChartView uses this (not a reactive statement on windowSeconds) to write
  // through to persistence, so seeding the initial value on mount can never
  // be mistaken for a user change.
  export let onWindowSecondsChange: (seconds: number) => void = () => {};

  const windowOptions: { label: string; value: number }[] = [
    { label: "All history", value: 0 },
    { label: "Last 5 min", value: 300 },
    { label: "Last 15 min", value: 900 },
    { label: "Last 60 min", value: 3600 },
    { label: "Last 3 hours", value: 10800 },
    { label: "Last 6 hours", value: 21600 },
    { label: "Last 12 hours", value: 43200 },
    { label: "Last 1 day", value: 86400 },
  ];
  $: windowLabel =
    windowOptions.find((o) => o.value === windowSeconds)?.label ?? "Custom";
  $: isCustomSelected = !windowOptions.some((o) => o.value === windowSeconds);

  const selectPreset = (seconds: number) => {
    windowSeconds = seconds;
    onWindowSecondsChange(seconds);
  };

  type Unit = "seconds" | "minutes" | "hours" | "days";
  const unitFactors: Record<Unit, number> = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
  };
  const unitOptions: { label: string; value: Unit }[] = [
    { label: "sec", value: "seconds" },
    { label: "min", value: "minutes" },
    { label: "hr", value: "hours" },
    { label: "day", value: "days" },
  ];

  // Reverse-map a non-preset seconds value to a {value, unit} pair, using the
  // largest unit that divides it evenly, so the custom field can be seeded
  // from a persisted value.
  const reverseMap = (s: number): { value: number; unit: Unit } => {
    if (s % 86400 === 0) return { value: s / 86400, unit: "days" };
    if (s % 3600 === 0) return { value: s / 3600, unit: "hours" };
    if (s % 60 === 0) return { value: s / 60, unit: "minutes" };
    return { value: s, unit: "seconds" };
  };

  // Last valid custom value/unit. Seeded once on mount from windowSeconds if
  // it doesn't match a preset; otherwise defaults, per the edge case that a
  // preset match leaves the custom field at its default.
  let customValue = 1;
  let customUnit: Unit = "seconds";

  onMount(() => {
    if (isCustomSelected) {
      const seeded = reverseMap(windowSeconds);
      customValue = seeded.value;
      customUnit = seeded.unit;
    }
  });

  const applyCustom = () => {
    const seconds = customValue * unitFactors[customUnit];
    windowSeconds = seconds;
    onWindowSecondsChange(seconds);
  };

  // BaseNumberInput does not validate or emit a number -- it forwards `min`
  // as a plain HTML attribute and passes the raw input string through
  // unchanged. Parse and validate here; reject empty/NaN/<1 and keep the
  // last valid value rather than ever feeding a bad value into windowSeconds.
  const onCustomValueChange = (raw: string | undefined) => {
    if (raw === undefined || raw === "") return;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) return;
    customValue = parsed;
    applyCustom();
  };

  const onCustomUnitChange = (unit: Unit) => {
    customUnit = unit;
    applyCustom();
  };
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
            isSelected={windowSeconds === option.value}
            onClick={() => selectPreset(option.value)}
            >{option.label}</DropdownMenuItem
          >
        {/each}
      </div>
      <div
        class={twMerge(
          "flex items-center gap-2 mt-1 p-1 rounded",
          isCustomSelected ? "border-primary border-[1px]" : ""
        )}
      >
        <span class="text-sm text-secondary-text whitespace-nowrap">Custom</span>
        <div
          class="w-[64px]"
          role="presentation"
          on:keydown|stopPropagation
          on:click|stopPropagation
        >
          <BaseNumberInput
            name="ChartCustomWindowValue"
            min={1}
            value={customValue}
            onChange={onCustomValueChange}
          />
        </div>
        <!-- Plain buttons, not DropdownMenuItem: a melt menu item dismisses the
             menu on click, which would close the options menu every time the
             user picks a unit. These keep the custom row interactive. -->
        <div
          class="flex gap-1"
          role="presentation"
          on:keydown|stopPropagation
          on:click|stopPropagation
        >
          {#each unitOptions as u (u.value)}
            <button
              type="button"
              class={twMerge(
                "cursor-pointer rounded px-2 py-1 text-sm text-white-text hover:bg-elevation-2-hover hover:text-emphasis",
                customUnit === u.value ? "border-primary border-[1px]" : ""
              )}
              on:click={() => onCustomUnitChange(u.value)}>{u.label}</button
            >
          {/each}
        </div>
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
