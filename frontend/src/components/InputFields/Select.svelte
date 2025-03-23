<script lang="ts" generics="OptionType">
  import Icon from "@/components/Icon/Icon.svelte";
  import type { IconType } from "@/components/Icon/icons";
  import { writable } from "svelte/store";
  import { createSelect, melt, type SelectOption } from "@melt-ui/svelte";
  import { fade } from "svelte/transition";
  import { twMerge } from "tailwind-merge";
  import { untypedColors } from "./colors";

  export let disabled = false;
  export let sameWidth = false;
  export let name = undefined as string | undefined;
  export let options: OptionType[] = [];
  export let defaultValue = undefined as OptionType | undefined;
  export let getOptionLabel: (option: OptionType) => string;

  $: disabled,
    (() => {
      disabledStore.set(disabled);
    })();
  export let selected = writable<SelectOption<OptionType | undefined>>(
    defaultValue !== undefined
      ? { value: defaultValue, label: getOptionLabel(defaultValue) }
      : undefined
  );

  export let placeholder = undefined as string | undefined;
  export let label = undefined as string | undefined;
  export let icon = undefined as IconType | undefined;
  export let bgColor = untypedColors["elevation-0"]["DEFAULT"] as
    | string
    | undefined;
  export let buttonClass = "";
  export let onChange = (value: OptionType | undefined) => {};

  const {
    elements: {
      trigger,
      menu,
      option,
      group,
      groupLabel,
      label: meltLabel,
      hiddenInput,
    },
    options: { disabled: disabledStore },
    states: { selectedLabel, open },
    helpers: { isSelected },
  } = createSelect({
    name,
    forceVisible: true,
    selected,
    positioning: {
      placement: "bottom-start",
      fitViewport: true,
      sameWidth,
    },
    onSelectedChange: ({ curr, next }) => {
      onChange(next?.value);
      return next;
    },
  });

  $: isOpen = $open;
  $: hasContent = $selected !== undefined && $selected.value !== "";
  $: hasIcon = icon !== undefined;
  let isFocused = false;
  const onFocus = () => (isFocused = true);
  const onBlur = () => (isFocused = false);

  let isHovered = false;
  const onMouseEnter = () => (isHovered = true);
  const onMouseLeave = () => (isHovered = false);

  $: hoveredLabelColorClass =
    isHovered && !disabled ? "text-white" : "text-secondary-text";
  $: labelColorClass =
    isOpen || isFocused ? "text-primary" : hoveredLabelColorClass;

  $: hoveredBorderColorClass =
    isHovered && !disabled ? "border-hovered" : "border-outline";
  $: borderColorClass =
    isOpen || isFocused ? "border-primary" : hoveredBorderColorClass;

  $: labelIsTop = isFocused || hasContent || isOpen;

  const getLabelLeftPx = (labelIsTop: boolean, hasIcon: boolean) => {
    if (labelIsTop) {
      return "-6px";
    }
    if (hasIcon) {
      return "24px";
    }
    if (!hasIcon) {
      return "2px";
    }
  };
</script>

<input use:melt={$hiddenInput} />
<div
  class={`w-full relative ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  <button
    class={twMerge(
      "w-full h-[30px] flex relative rounded border transition-colors focus:outline-none",
      "py-1",
      disabled ? "cursor-not-allowed" : "cursor-pointer",
      buttonClass,
      borderColorClass
    )}
    {disabled}
    use:melt={$trigger}
    style:background-color={bgColor}
    style:padding-left={hasIcon ? "36px" : "10px"}
    aria-label={label}
    on:blur={onBlur}
    on:focus={onFocus}
  >
    {$selectedLabel ?? placeholder ?? label}
    <div
      class={twMerge(
        "absolute right-3 top-1/2 -translate-y-1/2 transition-transform",
        isOpen && "rotate-90",
        labelColorClass
      )}
    >
      <Icon type="right" size={16} />
    </div>
  </button>
  {#if label}
    {@const leftPx = getLabelLeftPx(labelIsTop, hasIcon)}
    <span
      class={`${labelColorClass} absolute px-[8px] -translate-y-1/2 transition-all pointer-events-none ${labelIsTop ? "text-sm" : "text-base"}`}
      style:top={labelIsTop ? "-25%" : "50%"}
      style:left={leftPx}
    >
      <label class="block" use:melt={$meltLabel} for={name}>{label}</label>
    </span>
  {/if}
  {#if $open}
    <div
      class="z-10 flex max-h-[300px] flex-col
        overflow-y-auto rounded bg-elevation-2 p-1
        shadow focus:!ring-0"
      use:melt={$menu}
      transition:fade={{ duration: 150 }}
    >
      {#each options as item}
        <div
          class="relative cursor-pointer rounded py-1 px-2 text-white-text focus:z-10
              data-[highlighted]:bg-elevation-2-hover data-[highlighted]:text-white
              data-[selected]:border-primary data-[selected]:border-[1px]"
          use:melt={$option({ value: item, label: getOptionLabel(item) })}
        >
          {getOptionLabel(item)}
        </div>
      {/each}
    </div>
  {/if}
</div>
