<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import {
    customWindowSeconds,
    maxValueForUnit,
    parseCustomValue,
    reverseMap,
    type Unit,
  } from "./chart-custom-window";

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
  $: isCustomSelected = !windowOptions.some((o) => o.value === windowSeconds);
  // Announced label for the current window. For a custom interval, name the
  // actual interval ("Last 2 hours") rather than a bare "Custom".
  $: windowLabel =
    windowOptions.find((o) => o.value === windowSeconds)?.label ??
    `Last ${customValue} ${
      customValue === 1 ? customUnit.slice(0, -1) : customUnit
    }`;

  const selectPreset = (seconds: number) => {
    // Drop any in-flight custom edit: without this, the custom field's blur
    // (fired when the menu closes on preset click) would re-commit the stale
    // custom value over the preset.
    cancelPendingCommit();
    customEdited = false;
    customError = undefined;
    windowSeconds = seconds;
    onWindowSecondsChange(seconds);
  };

  const unitOptions: { label: string; value: Unit }[] = [
    { label: "sec", value: "seconds" },
    { label: "min", value: "minutes" },
    { label: "hr", value: "hours" },
    { label: "day", value: "days" },
  ];

  // Last applied custom value/unit. Seeded once on mount from windowSeconds if
  // it doesn't match a preset; otherwise defaults, per the edge case that a
  // preset match leaves the custom field at its default.
  let customValue = 1;
  let customUnit: Unit = "seconds";
  let customError: string | undefined = undefined;
  let customInputEl: HTMLInputElement | undefined = undefined;

  onMount(() => {
    if (isCustomSelected) {
      const seeded = reverseMap(windowSeconds);
      customValue = seeded.value;
      customUnit = seeded.unit;
    }
  });

  // Typing must not apply-and-persist per keystroke (typing 3600 would sweep
  // the chart through windows 3/36/360 and write each to the DB). Edits are
  // debounced; Enter, blur and a unit click commit immediately.
  const COMMIT_DEBOUNCE_MS = 400;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  // True while the field holds an edit that hasn't been committed. Gates the
  // blur commit: blur must never re-commit an already-applied value (the
  // field also blurs when the menu closes, e.g. right after a preset click).
  let customEdited = false;

  const cancelPendingCommit = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  };

  onDestroy(cancelPendingCommit);

  // Parse whatever is in the field, clamp it, write the clamped value back so
  // the box always shows the value actually applied, then apply and persist.
  // Unusable text (empty/non-numeric) leaves the previous window untouched and
  // shows an error until the text becomes usable or blur restores it.
  const commitCustom = () => {
    cancelPendingCommit();
    const raw = customInputEl ? customInputEl.value : String(customValue);
    const parsed = parseCustomValue(raw, customUnit);
    if (parsed === null) {
      customError = "Enter a number";
      return;
    }
    customEdited = false;
    customError = undefined;
    customValue = parsed;
    // The prop alone can't correct the field when the parsed value equals the
    // previous one (e.g. 1.5 rounding back to an already-applied 2), so sync
    // the input element directly.
    if (customInputEl && customInputEl.value !== String(parsed)) {
      customInputEl.value = String(parsed);
    }
    const seconds = customWindowSeconds(parsed, customUnit);
    if (seconds !== windowSeconds) {
      windowSeconds = seconds;
      onWindowSecondsChange(seconds);
    }
  };

  // BaseNumberInput does not validate or emit a number -- it forwards
  // min/max as plain HTML attributes and passes the raw input string through
  // unchanged, so all parsing happens at commit time.
  const onCustomValueChange = (raw: string | undefined) => {
    cancelPendingCommit();
    customEdited = true;
    if (raw === undefined || raw.trim() === "") {
      customError = "Enter a number";
      return;
    }
    customError = undefined;
    commitTimer = setTimeout(commitCustom, COMMIT_DEBOUNCE_MS);
  };

  const onCustomBlur = () => {
    // Nothing pending: leave the applied window alone (this blur also fires
    // when the menu unmounts).
    if (!customEdited) return;
    const parsed = parseCustomValue(customInputEl?.value, customUnit);
    if (parsed === null) {
      // Don't leave an unusable field behind: restore the last applied value.
      cancelPendingCommit();
      customEdited = false;
      customError = undefined;
      if (customInputEl) customInputEl.value = String(customValue);
      return;
    }
    commitCustom();
  };

  const onCustomUnitChange = (unit: Unit) => {
    customUnit = unit;
    commitCustom();
  };

  // The custom row lives inside a melt dropdown menu: letting keys bubble
  // would trigger the menu's typeahead/navigation while typing digits. Stop
  // everything except Escape (so the menu stays keyboard-closable from the
  // field) and commit immediately on Enter.
  const onCustomRowKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitCustom();
    }
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
          isCustomSelected ? "border-primary border" : ""
        )}
      >
        <span class="text-sm text-secondary-text whitespace-nowrap">Custom</span>
        <div
          class="w-[64px]"
          role="presentation"
          on:keydown={onCustomRowKeydown}
          on:click|stopPropagation
        >
          <BaseNumberInput
            name="ChartCustomWindowValue"
            min={1}
            max={maxValueForUnit(customUnit)}
            value={customValue}
            hasError={!!customError}
            onChange={onCustomValueChange}
            onBlur={onCustomBlur}
            bind:inputEl={customInputEl}
          />
        </div>
        <!-- Plain buttons, not DropdownMenuItem: a melt menu item dismisses the
             menu on click, which would close the options menu every time the
             user picks a unit. These keep the custom row interactive. -->
        <div
          class="flex gap-1"
          role="presentation"
          on:keydown={onCustomRowKeydown}
          on:click|stopPropagation
        >
          {#each unitOptions as u (u.value)}
            <button
              type="button"
              class={twMerge(
                "cursor-pointer rounded px-2 py-1 text-sm text-white-text hover:bg-elevation-2-hover hover:text-emphasis",
                customUnit === u.value ? "border-primary border" : ""
              )}
              on:click={() => onCustomUnitChange(u.value)}>{u.label}</button
            >
          {/each}
        </div>
      </div>
      {#if customError}
        <!-- Rendered at row level, not via BaseNumberInput's errorMessage:
             that span absolutely positions inside the 64px field and clips. -->
        <div class="mt-1 px-1 text-sm text-error">{customError}</div>
      {/if}
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
