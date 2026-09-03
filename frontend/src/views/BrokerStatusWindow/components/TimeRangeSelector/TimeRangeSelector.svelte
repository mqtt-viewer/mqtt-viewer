<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";
  import {
    PRESET_MINUTES,
    formatRangeLabel,
    maxRangeValueForUnit,
    parseRangeValue,
    rangeMinutes,
    reverseMapMinutes,
    type Unit,
  } from "./time-range";

  // Selected window in minutes. May be fractional (30 seconds is 0.5) and may
  // sit outside `options` when the custom interval is in use.
  export let value = 5;
  // Preset windows offered as segments, in minutes.
  export let options: number[] = PRESET_MINUTES;
  // Optional note explaining sparse broker series at short ranges; shown as a
  // tooltip on the whole group when set (nothing is ever disabled).
  export let sparseNote: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ change: number }>();

  $: isCustomSelected = !options.includes(value);
  // The custom segment names the actual interval once it is the live one, so
  // the group always reads back the window on screen.
  $: customLabel = isCustomSelected ? formatRangeLabel(value) : "Custom";

  const segmentClass = (selected: boolean) =>
    twMerge(
      "rounded px-2 py-0.5 text-sm tabular-nums transition-colors",
      selected
        ? "bg-selected text-emphasis"
        : "text-secondary-text hover:text-emphasis"
    );

  const unitOptions: { label: string; value: Unit }[] = [
    { label: "sec", value: "seconds" },
    { label: "min", value: "minutes" },
    { label: "hr", value: "hours" },
    { label: "day", value: "days" },
  ];

  // Last applied custom value/unit. Seeded once on mount from `value` when it
  // is not a preset; otherwise left at a sensible default of one hour.
  let customValue = 1;
  let customUnit: Unit = "hours";
  let customError: string | undefined = undefined;
  let customInputEl: HTMLInputElement | undefined = undefined;

  onMount(() => {
    if (isCustomSelected) {
      const seeded = reverseMapMinutes(value);
      customValue = seeded.value;
      customUnit = seeded.unit;
    }
  });

  // Typing must not apply per keystroke (typing 120 would sweep the window
  // through 1, then 12, then 120). Edits are debounced; Enter, blur and a unit
  // click commit immediately.
  const COMMIT_DEBOUNCE_MS = 400;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  // True while the field holds an edit that has not been committed. Gates the
  // blur commit: blur must never re-commit an already-applied value (the field
  // also blurs when the menu closes, e.g. right after a preset click).
  let customEdited = false;

  const cancelPendingCommit = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
  };

  onDestroy(cancelPendingCommit);

  const apply = (minutes: number) => {
    if (minutes === value) return;
    value = minutes;
    dispatch("change", minutes);
  };

  const selectPreset = (minutes: number) => {
    // Drop any in-flight custom edit: without this, the custom field's blur
    // (fired when the menu closes) would re-commit the stale custom value over
    // the preset.
    cancelPendingCommit();
    customEdited = false;
    customError = undefined;
    apply(minutes);
  };

  // Parse whatever is in the field, clamp it, write the clamped value back so
  // the box always shows the value actually applied, then apply it. Unusable
  // text leaves the previous window untouched and shows an error until the
  // text becomes usable or blur restores it.
  const commitCustom = () => {
    cancelPendingCommit();
    const raw = customInputEl ? customInputEl.value : String(customValue);
    const parsed = parseRangeValue(raw, customUnit);
    if (parsed === null) {
      customError = "Enter a number";
      return;
    }
    customEdited = false;
    customError = undefined;
    customValue = parsed;
    // The prop alone cannot correct the field when the parsed value equals the
    // previous one (e.g. 1.5 rounding back to an already-applied 2), so sync
    // the input element directly.
    if (customInputEl && customInputEl.value !== String(parsed)) {
      customInputEl.value = String(parsed);
    }
    apply(rangeMinutes(parsed, customUnit));
  };

  // BaseNumberInput does not validate or emit a number: it forwards min/max as
  // plain HTML attributes and passes the raw input string through unchanged,
  // so all parsing happens at commit time.
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
    const parsed = parseRangeValue(customInputEl?.value, customUnit);
    if (parsed === null) {
      // Do not leave an unusable field behind: restore the last applied value.
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

<Tooltip text={sparseNote ?? ""} placement="bottom" class="inline-flex w-fit">
  <div
    class="inline-flex items-center gap-0.5 rounded border border-outline bg-elevation-1 p-0.5"
    role="group"
    aria-label="Time range"
  >
    {#each options as minutes (minutes)}
      <button
        type="button"
        aria-pressed={minutes === value}
        class={segmentClass(minutes === value)}
        on:click={() => selectPreset(minutes)}
      >
        {formatRangeLabel(minutes)}
      </button>
    {/each}

    <DropdownMenu
      placement="bottom-end"
      triggerButtonClass={segmentClass(isCustomSelected)}
    >
      <span slot="trigger">{customLabel}</span>
      <div slot="menu-content" class="flex flex-col gap-1 p-1">
        <div class="flex items-center gap-2">
          <div
            class="w-[64px]"
            role="presentation"
            on:keydown={onCustomRowKeydown}
            on:click|stopPropagation
          >
            <BaseNumberInput
              name="BrokerStatusCustomRangeValue"
              min={1}
              max={maxRangeValueForUnit(customUnit)}
              value={customValue}
              hasError={!!customError}
              onChange={onCustomValueChange}
              onBlur={onCustomBlur}
              bind:inputEl={customInputEl}
            />
          </div>
          <!-- Plain buttons, not DropdownMenuItem: a melt menu item dismisses
               the menu on click, which would close this menu every time the
               user picks a unit. -->
          <div
            class="flex gap-1"
            role="presentation"
            on:keydown={onCustomRowKeydown}
            on:click|stopPropagation
          >
            {#each unitOptions as unit (unit.value)}
              <button
                type="button"
                aria-pressed={customUnit === unit.value}
                class={segmentClass(customUnit === unit.value)}
                on:click={() => onCustomUnitChange(unit.value)}
              >
                {unit.label}
              </button>
            {/each}
          </div>
        </div>
        {#if customError}
          <!-- Rendered at row level, not via BaseNumberInput's errorMessage:
               that span absolutely positions inside the 64px field and clips. -->
          <div class="px-1 text-sm text-error">{customError}</div>
        {/if}
      </div>
    </DropdownMenu>
  </div>
</Tooltip>
