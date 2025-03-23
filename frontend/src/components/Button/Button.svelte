<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import type { IconType } from "../Icon/icons";
  import Icon from "../Icon/Icon.svelte";
  interface $$Props extends HTMLButtonAttributes {
    as?: string;
    variant?: "primary" | "secondary" | "text";
    iconType?: IconType;
    iconSize?: number;
    iconPlacement?: "left" | "right";
    iconClass?: string;
    forceHover?: boolean;
    preventFocus?: boolean;
  }

  export let as: string = "button";
  export let variant: $$Props["variant"] = "secondary";
  export let iconType: $$Props["iconType"] = undefined;
  export let iconSize: $$Props["iconSize"] = 22;
  export let iconPlacement: $$Props["iconPlacement"] = "left";
  export let iconClass: $$Props["iconClass"] = "";
  export let forceHover = false;
  export let preventFocus = false;

  $: isDisabled = !!$$restProps.disabled;
  $: isNotButton = as !== "button";
</script>

<svelte:element
  this={as}
  on:click
  on:mousedown={preventFocus
    ? (e) => {
        e.preventDefault();
      }
    : undefined}
  {...$$restProps}
  class={twMerge(
    "transition-colors cursor-pointer",
    "flex items-center gap-2",
    "enabled:hover:text-white enabled:group-hover:text-white",
    isNotButton && "hover:text-white group-hover:text-white",
    variant !== "text" ? "h-[30px] rounded px-4 py-1" : "text-secondary-text",
    variant === "primary"
      ? "bg-button enabled:hover:bg-hovered border-[1px] border-gray-600"
      : "",
    variant === "primary" && isNotButton && "hover:bg-hovered",
    variant === "secondary" ? "bg-button enabled:hover:bg-hovered" : "",
    variant === "secondary" && isNotButton && "hover:bg-hovered",
    forceHover && "text-white",
    forceHover && variant !== "text" && "bg-hovered",
    isDisabled && "cursor-not-allowed opacity-60",
    $$restProps.class
  )}
>
  {#if !!iconType && iconPlacement === "left"}
    <div class={iconClass}>
      <Icon size={iconSize} type={iconType} />
    </div>
  {/if}
  <slot />
  {#if !!iconType && iconPlacement === "right"}
    <div class="flex grow justify-end">
      <div class={iconClass}>
        <Icon size={iconSize} type={iconType} />
      </div>
    </div>
  {/if}
</svelte:element>
