<script lang="ts">
  import { createSwitch, melt } from "@melt-ui/svelte";
  import { writable } from "svelte/store";

  export let disabled = false;
  export let name: string;
  export let label: string = "";
  export let defaultChecked = false;
  export let checked = writable(defaultChecked);
  export let checkedBool = defaultChecked;
  export let onChange = (newChecked: boolean) => {
    checkedBool = newChecked;
  };

  $: disabled, (() => disabledStore.set(disabled))();

  const {
    elements: { root, input },
    states: {},
    options: { disabled: disabledStore },
  } = createSwitch({
    name,
    checked,
    defaultChecked,
    onCheckedChange: ({ curr, next }) => {
      // console.log("checked", curr, next, name);
      onChange(next);
      return next;
    },
  });

  $: labelName = name + "-label";

  let isHovered = false;
  const onMouseEnter = () => (isHovered = true);
  const onMouseLeave = () => (isHovered = false);

  $: labelColor = isHovered && !disabled ? "text-white" : "text-secondary-text";

  $: hoveredSwitchBgColor = isHovered && !disabled ? "bg-hovered" : "bg-switch";
  $: hoveredCheckedSwitchBgColor =
    isHovered && !disabled ? "bg-primary-light" : "bg-primary";
  $: switchBgColor = $checked
    ? hoveredCheckedSwitchBgColor
    : hoveredSwitchBgColor;
</script>

<div
  use:melt={$root}
  class={`flex items-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"} w-fit
    ${disabled ? "opacity-60" : ""}
  `}
  on:mouseenter={onMouseEnter}
  on:mouseleave={onMouseLeave}
>
  <button
    class={`${switchBgColor}  relative h-5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"} rounded-full transition-colors
    `}
    id={name}
    aria-labelledby={labelName}
  >
    <span
      class={`thumb block rounded-full bg-white transition ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    />
  </button>
  {#if !!label}
    <div
      class={`${labelColor} pl-4 leading-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"} transition-colors`}
      id={labelName}
    >
      {label}
    </div>
  {/if}
  <input use:melt={$input} />
</div>

<style>
  button {
    --w: 2.25rem;
    --padding: 0.2rem;
    width: var(--w);
  }

  .thumb {
    --size: 0.85rem;
    width: var(--size);
    height: var(--size);
    transform: translateX(var(--padding));
  }

  :global([data-state="checked"]) .thumb {
    transform: translateX(calc(var(--w) - var(--size) - var(--padding)));
  }
</style>
