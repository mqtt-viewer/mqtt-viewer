<!-- Lazy hack copy of Input just to expose a value of type number -->
<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import type { HTMLInputAttributes } from "svelte/elements";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { IconType } from "@/components/Icon/icons";
  import { createEventDispatcher } from "svelte";
  import { ERROR_MESSAGE_CLASS } from "./classes";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  interface $$Props extends HTMLInputAttributes {
    name: string;
    label?: string | undefined;
    hasError?: boolean | undefined;
    errorMessage?: string | undefined;
    bgColor?: string;
    bgHoverColor?: string | undefined;
    icon?: IconType;
    onChange?: (value: string | undefined) => void;
    onBlur?: () => void;
    onFocus?: () => void;
    width?: number | undefined;
    inputEl?: HTMLInputElement | undefined;
    valueNumber?: number | undefined;
  }
  export let name = "";
  export let value = undefined as number | undefined;
  export let label = undefined as string | undefined;
  export let errorMessage = undefined as string | undefined;
  export let hasError = false;
  export let bgColor = untypedColors["elevation-0"]["DEFAULT"] as
    | string
    | undefined;
  export let bgHoverColor = undefined as string | undefined;
  export let icon = undefined as IconType | undefined;
  export let onChange = (value: string | undefined) => {};
  export let onBlur = () => {};
  export let onFocus = () => {};
  export let width: number | undefined = undefined;
  export let inputEl: HTMLInputElement | undefined = undefined;

  $: disabled = $$restProps.disabled;
  let isFocused = false;
  let isHovered = false;
  const onMouseEnter = () => (isHovered = true);
  const onMouseLeave = () => (isHovered = false);

  $: showErrorState = !!(errorMessage ?? hasError);
  $: hasContent = !!value;
  $: hasIcon = icon !== undefined;
  const dispatch = createEventDispatcher();
  const onFocusInternal = () => {
    isFocused = true;
    if (!!onFocus) {
      onFocus();
    }
    dispatch("focus");
  };
  const onBlurInternal = () => {
    isFocused = false;
    if (!!onBlur) {
      onBlur();
    }
    dispatch("blur");
  };

  $: hoveredInputLabelColorClass =
    isHovered && !disabled ? "text-white" : "text-secondary-text";
  $: validInputLabelColorClass = isFocused
    ? "text-primary"
    : hoveredInputLabelColorClass;
  $: inputLabelColorClass = showErrorState
    ? "text-error"
    : validInputLabelColorClass;

  $: hoveredInputBorderColorClass =
    isHovered && !disabled ? "border-hovered" : "border-outline";
  $: validInputBorderColorClass = isFocused
    ? "border-primary"
    : hoveredInputBorderColorClass;
  $: inputBorderColorClass = showErrorState
    ? "border-error"
    : validInputBorderColorClass;

  $: hoveredBgColor =
    isHovered && !disabled ? (bgHoverColor ?? bgColor) : bgColor;

  $: labelIsTop = isFocused || hasContent || hasError;

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

<fieldset
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
  class={twMerge("relative w-full", $$restProps.class)}
  bind:clientWidth={width}
>
  {#if label}
    {@const leftPx = getLabelLeftPx(labelIsTop, hasIcon)}
    <span
      class={`absolute px-[8px] -translate-y-1/2 transition-[font-size,_color,_left,_top] pointer-events-none
      ${labelIsTop ? "text-sm" : "text-base"}
      ${inputLabelColorClass}
      ${disabled ? "opacity-60" : ""}`}
      style:background-color={undefined}
      style:top={labelIsTop ? "-25%" : "50%"}
      style:left={leftPx}
    >
      <label for={name}>{label}</label>
    </span>
  {/if}
  {#if icon}
    <div
      class="absolute top-1/2 left-3 -translate-y-1/2 transition-colors"
      style:background-color={hoveredBgColor}
    >
      <Icon type={icon} size={14} />
    </div>
  {/if}
  <input
    data-felte-keep-on-remove
    autocorrect="off"
    {...$$restProps}
    type="number"
    {name}
    bind:value
    bind:this={inputEl}
    on:input={(e) => onChange(e?.currentTarget?.value)}
    on:focus={onFocusInternal}
    on:blur={onBlurInternal}
    class={twMerge(
      "w-full h-[30px] inline-block rounded border transition-colors focus:outline-none",
      "py-1 px-1",
      label !== undefined ? "label-moves-to-top" : "",
      disabled ? "cursor-not-allowed opacity-60" : "",
      inputBorderColorClass
    )}
    style:padding-left={hasIcon ? "32px" : "10px"}
    style:background-color={hoveredBgColor}
  />
  {#if errorMessage}
    <span class={ERROR_MESSAGE_CLASS}>
      {errorMessage}
    </span>
  {/if}
</fieldset>

<style>
  input::-webkit-input-placeholder.label-moves-to-top {
    -webkit-transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0;
    background-color: yellowgreen;
  }

  input:focus::-webkit-input-placeholder.label-moves-to-top {
    opacity: 1;
    background-color: yellowgreen;
  }

  input:placeholder-shown {
    text-overflow: ellipsis;
  }
</style>
