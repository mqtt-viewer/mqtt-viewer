<script lang="ts">
  import { setContext } from "svelte";
  import { createContextMenu, melt } from "@melt-ui/svelte";
  import { fly } from "svelte/transition";

  /**
   * Right-click menu for a region of the UI.
   *
   * The menu opens at the pointer, so one instance covers a whole region
   * rather than needing an instance per row. That matters where the region is
   * a virtualised list or a canvas: per-item menus would multiply floating-ui
   * instances across the hottest render path.
   *
   * Consumers resolve what was right-clicked in `onOpen` and return false to
   * suppress the menu (e.g. the pointer was over empty space). `onOpen` runs
   * before the menu opens, so it is the place to set up whatever the menu
   * content renders from.
   */

  /**
   * Where to render the menu. `null` keeps it inline, next to the trigger.
   * Anything rendered inside an element that goes fullscreen must NOT portal
   * to document.body, or it disappears when that element is fullscreened.
   */
  export let portal: HTMLElement | string | null = null;

  /**
   * Called on right-click before the menu opens. Return false to suppress it.
   */
  export let onOpen: (event: MouseEvent) => boolean = () => true;

  const {
    elements,
    states: { open },
  } = createContextMenu({
    forceVisible: true,
    loop: true,
    portal,
  });

  const { trigger, menu } = elements;

  // DropdownMenuItem reads its melt `item` element from this context, so the
  // two menu kinds share one item component.
  setContext("menu-elements", elements);

  export const close = () => open.set(false);

  // Capture phase on a wrapper ABOVE melt's trigger, so this runs before melt's
  // own handler on the trigger element and can stop the menu from opening at
  // all. A listener on the trigger itself would be ordering-dependent.
  const handleCapture = (event: MouseEvent) => {
    if (onOpen(event)) return;
    event.stopPropagation();
    event.preventDefault();
  };
</script>

<div class="contents" on:contextmenu|capture={handleCapture}>
  <div class="contents" use:melt={$trigger}>
    <slot name="trigger" />
  </div>
</div>

{#if $open}
  <div
    class="z-30 min-w-[100px] rounded bg-elevation-2 p-1 py-1.5 shadow focus:!ring-0"
    use:melt={$menu}
    transition:fly={{ duration: 150, y: -10 }}
  >
    <slot name="menu-content" />
  </div>
{/if}
