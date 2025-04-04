<script lang="ts">
  import { createContextMenu, melt } from "@melt-ui/svelte";
  import { writable } from "svelte/store";
  import Icon from "../Icon/Icon.svelte";

  const settingsSync = writable(true);
  const hideMeltUI = writable(false);

  const {
    elements: { trigger, menu, item, separator },
    builders: { createSubmenu, createMenuRadioGroup, createCheckboxItem },
  } = createContextMenu({
    loop: true,
  });

  const {
    elements: { subMenu: subMenuA, subTrigger: subTriggerA },
  } = createSubmenu();

  const {
    elements: { radioGroup, radioItem },
    helpers: { isChecked },
  } = createMenuRadioGroup({
    defaultValue: "Hunter Johnston",
  });

  const {
    elements: { checkboxItem },
  } = createCheckboxItem({
    checked: settingsSync,
  });

  const {
    elements: { checkboxItem: checkboxItemA },
  } = createCheckboxItem({
    checked: hideMeltUI,
  });

  const personsArr = [
    "Hunter Johnston",
    "Thomas G. Lopes",
    "Adrian Gonz",
    "Franck Poingt",
  ];
</script>

<span class="trigger" use:melt={$trigger} aria-label="Update dimensions">
  Right click me.
</span>
<div class=" menu" use:melt={$menu}>
  <div class="item" use:melt={$item}>About Melt UI</div>
  <div class="item" use:melt={$item}>Check for Updates...</div>
  <div class="separator" use:melt={$separator} />
  <div class="item" use:melt={$checkboxItem}>
    <div class="check">
      {#if $settingsSync}
        <Icon type="tick" size={16} />
      {/if}
    </div>
    Settings Sync is On
  </div>
  <div class="item" use:melt={$subTriggerA}>
    Profiles
    <div class="rightSlot">
      <Icon type="right" size={16} />
    </div>
  </div>
  <div class="menu subMenu" use:melt={$subMenuA}>
    <div class="text">People</div>
    <div use:melt={$radioGroup}>
      {#each personsArr as person}
        <div class="item" use:melt={$radioItem({ value: person })}>
          <div class="check">
            {#if $isChecked(person)}
              <div class="dot" />
            {/if}
          </div>
          {person}
        </div>
      {/each}
    </div>
  </div>
  <div use:melt={$separator} class="separator" />

  <div class="item" use:melt={$checkboxItemA}>
    <div class="check">
      {#if $hideMeltUI}
        <Icon type="tick" size={16} />
      {/if}
    </div>
    Hide Melt UI
    <div class="rightSlot">⌘H</div>
  </div>
  <div class="item" use:melt={$item} data-disabled>
    Show All Components
    <div class="rightSlot">⇧⌘N</div>
  </div>
  <div use:melt={$separator} class="separator" />
  <div class="item" use:melt={$item}>
    Quit Melt UI
    <div class="rightSlot">⌘Q</div>
  </div>
</div>

<style lang="postcss">
  .menu {
    @apply z-10 flex max-h-[300px] min-w-[220px] flex-col shadow;
    @apply rounded-lg bg-white p-1 lg:max-h-none;
    @apply ring-0 !important;
  }
  .subMenu {
    @apply min-w-[220px] shadow-md shadow-neutral-900/30;
  }
  .item {
    @apply relative h-6 min-h-[24px] select-none rounded-md pl-6 pr-1;
    @apply z-20 text-blue-900 outline-none;
    @apply data-[highlighted]:bg-blue-200 data-[highlighted]:text-blue-900;
    @apply data-[disabled]:text-neutral-300;
    @apply flex items-center text-sm leading-none;
    @apply ring-0 !important;
  }

  .trigger {
    @apply block rounded-xl border-2 border-dashed border-blue-900 font-semibold text-blue-700;
    @apply w-[300px] bg-blue-100 py-12 text-center shadow;
  }
  .check {
    @apply absolute left-2 top-1/2 text-blue-500;
    translate: 0 calc(-50% + 1px);
  }

  .dot {
    @apply h-[4.75px] w-[4.75px] rounded-full bg-blue-900;
  }

  .separator {
    @apply m-[5px] h-[1px] bg-blue-200;
  }

  .rightSlot {
    @apply ml-auto pl-5;
  }

  .check {
    @apply absolute left-0 inline-flex w-6 items-center justify-center;
  }
  .text {
    @apply pl-6 text-xs leading-6 text-neutral-600;
  }
</style>
