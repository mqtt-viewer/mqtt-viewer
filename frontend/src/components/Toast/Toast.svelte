<script lang="ts" context="module">
  export type ToastData = {
    title: string;
    description: string;
    type: "error" | "info" | "success";
    hideCloseButton?: boolean;
  };

  const {
    elements: { content, title, description, close },
    helpers,
    states: { toasts },
    actions: { portal },
  } = createToaster<ToastData>();

  export const addToast = helpers.addToast;
</script>

<script lang="ts">
  import { capitalizeFirstLetter } from "@/util/strings";

  import { createToaster, melt } from "@melt-ui/svelte";
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import Button from "../Button/Button.svelte";

  const getTypeColorClass = (type: ToastData["type"]) => {
    switch (type) {
      case "error":
        return "bg-error";
      case "info":
        return "bg-blue-500";
      case "success":
        return "bg-success";
    }
  };
</script>

<div
  class="fixed right-0 top-0 z-[10001] m-4 flex flex-col items-end gap-2 md:bottom-0 md:top-auto"
  use:portal
>
  {#each $toasts as { id, data } (id)}
    <div
      use:melt={$content(id)}
      animate:flip={{ duration: 500 }}
      in:fly={{ duration: 150, x: "100%" }}
      out:fly={{ duration: 150, x: "100%" }}
      class="rounded bg-neutral-800 text-white shadow-md"
    >
      <div
        class="relative flex w-[24rem] max-w-[calc(100vw-2rem)] items-center justify-between gap-4 p-5"
      >
        <div>
          <h3
            use:melt={$title(id)}
            class="flex items-center gap-2 font-semibold"
          >
            {data.title}
            <span
              class="size-1.5 rounded-full {getTypeColorClass(data.type)}"
            />
          </h3>
          <div use:melt={$description(id)}>
            {capitalizeFirstLetter(
              data?.description ??
                "Missing error message - please report this bug"
            )}
          </div>
        </div>
        {#if !data.hideCloseButton}
          <button
            use:melt={$close(id)}
            class="absolute right-4 top-4 grid size-6 place-items-center rounded-full text-magnum-500
          hover:bg-magnum-900/50"
          >
            <Button as="div" variant="text" iconType="close" iconSize={16} />
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>
