<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { twMerge } from "tailwind-merge";
  import panelSizes from "@/stores/panel-sizes";
  import os from "@/stores/env";
  interface $$Props extends HTMLAttributes<HTMLDivElement> {
    id: string;
    collapsed?: boolean;
    minSize: number;
    maxSize: number;
    resizeEdge?: "left" | "right" | "top";
    size?: number;
    width?: number;
    height?: number;
  }

  export let id: string;
  export let collapsed = false;
  export let minSize: number;
  export let maxSize: number;
  export let resizeEdge: "left" | "right" | "top" = "right";

  $: collapsed,
    (() => {
      panelSizes.updatePanelSize(id, size, !collapsed);
    })();

  let defaultSize = $panelSizes.resizablePanelSizes[id]?.size || minSize;
  if (defaultSize < minSize) defaultSize = minSize;
  if (defaultSize > maxSize) defaultSize = maxSize;
  let edgeHovered = false;
  let size = defaultSize;

  $: isVertical = resizeEdge === "top";

  let resizing = false;
  let linuxFirstMovementX = -999;
  let linuxFirstSize = 0;
  const onStartResize = () => {
    resizing = true;
    const onMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      if (resizing) {
        let newSize: number;
        if (isVertical) {
          // Dragging up (negative movementY) grows the panel.
          newSize = size - event.movementY;
        } else if (resizeEdge === "left") {
          newSize = size - event.movementX;
        } else {
          newSize = size + event.movementX;
        }
        if (newSize >= minSize && newSize <= maxSize) {
          size = newSize;
        }
      }
    };
    const onMouseMoveLinux = (event: MouseEvent) => {
      event.preventDefault();
      if (resizing) {
        const clientPos = isVertical ? event.clientY : event.clientX;
        if (linuxFirstMovementX === -999) {
          linuxFirstSize = size;
          linuxFirstMovementX = clientPos;
          console.log("first movement set to", linuxFirstMovementX);
        } else {
          const diff = clientPos - linuxFirstMovementX;
          console.log("diff =", diff, "due to", event);
          let newSize: number;
          if (isVertical) {
            newSize = linuxFirstSize - diff;
          } else if (resizeEdge === "left") {
            newSize = linuxFirstSize - diff;
          } else {
            newSize = linuxFirstSize + diff;
          }
          console.log("new size =", newSize);
          if (newSize >= minSize && newSize <= maxSize) {
            size = newSize;
          }
        }
      }
    };

    const onMouseUp = () => {
      resizing = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      panelSizes.updatePanelSize(id, size, true);
    };
    if ($os.isLinux) {
      window.addEventListener("mousemove", onMouseMoveLinux);
    } else {
      window.addEventListener("mousemove", onMouseMove);
    }
    window.addEventListener("mouseup", onMouseUp);
  };

  export let width: number = 0;
  export let height: number = 0;
  $: if (!isVertical) width = !collapsed ? size : 30;
  $: if (isVertical) height = !collapsed ? size : 30;
  $: minSize,
    maxSize,
    (() => {
      if (size < minSize) {
        size = minSize;
      }
      if (size > maxSize) {
        size = maxSize;
      }
    })();
</script>

<div
  {...$$restProps}
  class={twMerge(
    $$restProps.class,
    "relative",
    !resizing ? (isVertical ? "transition-[height]" : "transition-[width]") : ""
  )}
  style:width={!isVertical ? `${width}px` : undefined}
  style:height={isVertical ? `${height}px` : undefined}
>
  <slot />
  {#if isVertical}
    <div
      class={`absolute left-0 top-0 w-full h-[2px] z-10
          bg-emphasis transition-opacity duration-500
          ${edgeHovered || resizing ? "opacity-100 delay-200" : "opacity-0 delay-0"}
        `}
      on:mouseenter={!collapsed ? () => (edgeHovered = true) : undefined}
      on:mouseleave={!collapsed ? () => (edgeHovered = false) : undefined}
    />
    {#if !collapsed}
      <div
        class={twMerge(
          `absolute left-0 -top-[8px] h-2 w-full z-20
        cursor-row-resize`,
          size === minSize ? "cursor-n-resize" : "",
          size === maxSize ? "cursor-s-resize" : ""
        )}
        on:mouseenter={() => (edgeHovered = true)}
        on:mouseleave={() => (edgeHovered = false)}
        on:mousedown={onStartResize}
      />
    {/if}
  {:else}
    <div
      class={`absolute top-0 h-full w-[2px] z-10 translate-x-1/2
          bg-emphasis transition-opacity duration-500
          ${resizeEdge === "right" ? "right-0" : "left-0"}
          ${edgeHovered || resizing ? "opacity-100 delay-200" : "opacity-0 delay-0"}
        `}
      on:mouseenter={!collapsed ? () => (edgeHovered = true) : undefined}
      on:mouseleave={!collapsed ? () => (edgeHovered = false) : undefined}
    />
    {#if !collapsed}
      <div
        class={twMerge(
          `absolute top-0 h-full w-2 z-20 translate-x-1/2
        cursor-col-resize
        ${resizeEdge === "right" ? "right-0" : "-left-[8px]"}`,
          resizeEdge === "left" && size === minSize ? "cursor-w-resize" : "",
          resizeEdge === "left" && size === maxSize ? "cursor-e-resize" : "",
          resizeEdge === "right" && size === minSize ? "cursor-e-resize" : "",
          resizeEdge === "right" && size === maxSize ? "cursor-w-resize" : ""
        )}
        on:mouseenter={() => (edgeHovered = true)}
        on:mouseleave={() => (edgeHovered = false)}
        on:mousedown={onStartResize}
      />
    {/if}
  {/if}
</div>
