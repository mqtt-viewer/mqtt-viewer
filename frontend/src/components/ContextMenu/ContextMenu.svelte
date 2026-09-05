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
   * Where to render the menu, as a CSS selector for the destination element.
   * `null` keeps it inline, next to the trigger.
   *
   * Anything rendered inside an element that can go fullscreen must portal
   * into that element rather than to document.body, or it disappears when the
   * element is fullscreened.
   *
   * Deliberately a selector rather than an element: melt reads this once when
   * the menu is built, which happens before a parent's `bind:this` has been
   * assigned, so passing an element reference would pass undefined — and melt
   * treats an undefined portal as "portal to body" (getPortalDestination in
   * internal/helpers/elements.js). A selector is resolved lazily, when the menu
   * opens.
   */
  export let portal: string | null = null;

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
  <!--
    WHY flex-col: melt's menu container is `display: block` and
    DropdownMenuItem renders an inline-block <button>, so without an
    explicit vertical layout the items flow onto one horizontal row
    (measured 570-640px wide) and floating-ui then flips the menu far from
    the pointer. flex-col forces the vertical menu; min/max-w keep it from
    growing back into a single wide row or overflowing with long labels.

    outline-none / focus:outline-none: melt gives the menu `tabindex="-1"`
    and focuses it programmatically for keyboard nav (see
    @melt-ui/svelte/dist/builders/menu/create.js), which makes Chromium
    paint its default focus *outline* around the whole box. That is a plain
    CSS outline, not a Tailwind `ring` (box-shadow), so `focus:!ring-0` alone
    never silenced it. Neutralise only the outline here, on the container -
    items keep their own focus affordance via DropdownMenuItem.
  -->
  <div
    class="z-30 flex min-w-[180px] max-w-[320px] flex-col rounded bg-elevation-2 p-1 py-1.5 shadow outline-none focus:outline-none focus:!ring-0 focus:!ring-offset-0"
    use:melt={$menu}
    transition:fly={{ duration: 150, y: -10 }}
  >
    <slot name="menu-content" />
  </div>
{/if}
