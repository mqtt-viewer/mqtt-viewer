<script lang="ts">
  import { createDialog, melt } from "@melt-ui/svelte";
  import { flyAndScale } from "@/util/transitions";
  import { fade } from "svelte/transition";
  import { writable } from "svelte/store";
  import Button from "../Button/Button.svelte";

  export let title: string | undefined = undefined;
  export let description = undefined as string | undefined;
  export let isOpen = writable(false);
  export let onClose = () => {};
  export let noTitleMargin = false;
  export let startEmpty = false;
  export let showCloseButton = !startEmpty;

  $: $isOpen,
    (() => {
      if (!$isOpen) {
        onClose();
      }
    })();

  const {
    elements: {
      trigger,
      overlay,
      content,
      title: meltTitle,
      description: meltDescription,
      close,
      portalled,
    },
  } = createDialog({
    forceVisible: true,
    open: isOpen,
  });
</script>

<button use:melt={$trigger}>
  <slot name="trigger"></slot>
</button>

<div class="text-white-text overflow-auto" use:melt={$portalled}>
  {#if $isOpen}
    <div
      use:melt={$overlay}
      class="fixed inset-0 z-[9999] bg-black/70"
      transition:fade={{ duration: 150 }}
    ></div>
    <div
      class="fixed left-[50%] top-[50%] z-[10000] max-h-[85vh] min-w-[380px]
            max-w-[90vw] translate-x-[-50%] translate-y-[-50%] rounded bg-elevation-1
            shadow-lg"
      transition:flyAndScale={{
        duration: 150,
        y: 8,
        start: 0.96,
      }}
      use:melt={$content}
    >
      {#if startEmpty}
        <slot />
      {:else}
        <div class="p-6 size-full">
          <h2 use:melt={$meltTitle} class="m-0 text-lg font-medium">
            {title}
          </h2>
          {#if description}
            <p use:melt={$meltDescription} class="mb-5 mt-2 leading-normal">
              {description}
            </p>
          {/if}
          <div class={`text-secondary-text ${noTitleMargin ? "mt-0" : "mt-4"}`}>
            <slot />
          </div>
          {#if showCloseButton}
            <button
              use:melt={$close}
              aria-label="close"
              class="absolute right-[23px] top-[23px] inline-flex h-6 w-6 appearance-none
            items-center justify-center rounded p-1"
            >
              <Button as="div" variant="text" iconType="close" iconSize={16} />
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
