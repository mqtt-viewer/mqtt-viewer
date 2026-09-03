<script lang="ts">
  import { setContext } from "svelte";
  import { createDropdownMenu, melt } from "@melt-ui/svelte";
  import { fly } from "svelte/transition";
  import { writable } from "svelte/store";
  import Button from "../Button/Button.svelte";
  import { twMerge } from "tailwind-merge";

  export let disabled = false;
  // Controlled open state. Pass a store to read or close the menu from
  // outside (e.g. Escape inside a slotted input, or hiding a tooltip while
  // the menu is open).
  export let open = writable(false);
  export let triggerText = "";
  export let triggerClass = "";
  // Classes for the outer melt trigger <button> itself. The button is
  // shrink-to-fit by default, which makes a max-w-full child truncate against
  // the button's own first-pass width; pass w-full to give slotted content the
  // row's real width.
  export let triggerButtonClass = "";
  export let triggerIconSize = 16;
  export let triggerVariant = "secondary" as "primary" | "secondary" | "text";
  export let placement = undefined as
    | "top"
    | "top-start"
    | "top-end"
    | "right"
    | "right-start"
    | "right-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end"
    | undefined;

  const getPlacementLocation = (placement?: string) => {
    if (!placement) return null;
    if (placement.includes("top")) return "top";
    if (placement.includes("right")) return "right";
    if (placement.includes("bottom")) return "bottom";
    if (placement.includes("left")) return "left";
    return null;
  };

  const getArrowRotation = (placementLocation: string | null) => {
    if (!placementLocation) return "rotate-90";
    if (placementLocation === "top") return "-rotate-90";
    if (placementLocation === "right") return "rotate-0";
    if (placementLocation === "bottom") return "rotate-90";
    if (placementLocation === "left") return "rotate-180";
    return null;
  };

  $: placementLocation = getPlacementLocation(placement);
  $: arrowRotation = getArrowRotation(placementLocation);

  const { elements } = createDropdownMenu({
    forceVisible: true,
    loop: true,
    open,
  });

  const { trigger, menu, item, separator, arrow } = elements;

  setContext("menu-elements", elements);
</script>

<button type="button" class={`trigger ${triggerButtonClass}`} {disabled} use:melt={$trigger}>
  {#if $$slots.trigger}
    <slot name="trigger" />
  {:else}
    <Button
      {disabled}
      as="div"
      class={triggerClass}
      iconType="right"
      variant={triggerVariant}
      iconPlacement="right"
      iconSize={triggerIconSize}
      iconClass={twMerge(
        "transition-transform",
        $open ? arrowRotation : "rotate-0"
      )}
    >
      {#if $$slots["trigger-content"]}
        <slot name="trigger-content" />
      {:else}
        <span class="whitespace-nowrap"> {triggerText} </span>
      {/if}
    </Button>
  {/if}
  <slot />
  <span class="sr-only">Open Popover</span>
</button>

{#if $open}
  <div
    class={`
     z-[10002] p-1 py-1.5 min-w-[100px] shadow
     bg-elevation-2 rounded focus:!ring-0
  `}
    use:melt={$menu}
    transition:fly={{ duration: 150, y: -10 }}
  >
    <slot name="menu-content" />
    <!-- <div use:melt={$arrow} /> -->
  </div>
{/if}
