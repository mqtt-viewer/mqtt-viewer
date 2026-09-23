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
    defaultSize?: number;
    width?: number;
    height?: number;
  }

  export let id: string;
  export let collapsed = false;
  export let minSize: number;
  export let maxSize: number;
  export let resizeEdge: "left" | "right" | "top" = "right";
  // First-run size when nothing is persisted for this id yet; falls back to
  // minSize when unset.
  export let defaultSize: number | undefined = undefined;

  const storedSize =
    $panelSizes.resizablePanelSizes[id]?.size || defaultSize || minSize;
  let initialSize = storedSize;
  if (initialSize < minSize) initialSize = minSize;
  if (initialSize > maxSize) initialSize = maxSize;
  let edgeHovered = false;
  let size = initialSize;

  // Persist only deliberate user actions: collapse/expand here, drag end in
  // onMouseUp. Never persist from a plain reactive on `size`: the clamp
  // below rewrites size programmatically (dock switches, or a mount while
  // the root window size is still unknown), and persisting those writes
  // would permanently overwrite the user's saved size.
  let lastPersistedCollapsed = collapsed;
  $: if (collapsed !== lastPersistedCollapsed) {
    lastPersistedCollapsed = collapsed;
    panelSizes.updatePanelSize(id, size, !collapsed);
  }

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
        } else {
          const diff = clientPos - linuxFirstMovementX;
          let newSize: number;
          if (isVertical) {
            newSize = linuxFirstSize - diff;
          } else if (resizeEdge === "left") {
            newSize = linuxFirstSize - diff;
          } else {
            newSize = linuxFirstSize + diff;
          }
          if (newSize >= minSize && newSize <= maxSize) {
            size = newSize;
          }
        }
      }
    };

    const onMouseUp = () => {
      resizing = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousemove", onMouseMoveLinux);
      window.removeEventListener("mouseup", onMouseUp);
      // Reset the sentinel so the next Linux drag re-anchors from its own
      // starting position instead of the previous drag's.
      linuxFirstMovementX = -999;
      preferredSize = size;
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
  // The user's chosen size, tracked separately from the displayed size: a
  // dock switch (or small window) can shrink maxSize temporarily, and the
  // display should clamp without forgetting the choice, so the panel
  // springs back once the bound relaxes. Seeded from the unclamped stored
  // preference so degenerate mount-time bounds can't corrupt it. Never
  // persisted from here - see the note above the collapse persist.
  let preferredSize = storedSize;
  $: minSize,
    maxSize,
    (() => {
      let next = preferredSize;
      if (next < minSize) next = minSize;
      if (next > maxSize) next = maxSize;
      size = next;
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
