<script lang="ts">
  import { createTabs, melt } from "@melt-ui/svelte";
  import { cubicInOut } from "svelte/easing";
  import { crossfade } from "svelte/transition";
  import { twMerge } from "tailwind-merge";

  let className = "";
  export { className as class };
  export let defaultTab = 0;
  export let tabs: { title: string }[] = [];
  export let ariaLabel = "Tabs";

  const tabIds = ["tab-1", "tab-2", "tab-3"];

  const {
    elements: { root, list, content, trigger },
    states: { value },
  } = createTabs({
    defaultValue: tabIds[defaultTab],
  });

  const [send, receive] = crossfade({
    duration: 250,
    easing: cubicInOut,
  });
</script>

<div
  use:melt={$root}
  class={twMerge("flex flex-col overflow-hidden", className)}
>
  <div
    use:melt={$list}
    class="flex shrink-0 relative overflow-hidden"
    aria-label={ariaLabel}
  >
    <div class="absolute bottom-[2px] h-[1px] w-full bg-outline"></div>
    {#each tabs as tab, i}
      <button
        use:melt={$trigger(tabIds[i])}
        class={`trigger relative p-[10px] text-base
          ${$value === tabIds[i] ? "text-white" : "text-secondary-text"}
          hover:text-white transition-colors
        `}
      >
        {tab.title}
        {#if $value === tabIds[i]}
          <div
            in:send={{ key: "trigger" }}
            out:receive={{ key: "trigger" }}
            class="absolute bottom-[2px] left-1/2 h-[1px] w-full -translate-x-1/2 rounded bg-primary"
          />
        {/if}
      </button>
    {/each}
  </div>
  <div
    use:melt={$content(tabIds[0])}
    class="grow min-h-0 max-h-full overflow-auto"
  >
    <slot name="tab-1" />
  </div>
  <div
    use:melt={$content(tabIds[1])}
    class="grow min-h-0 max-h-full overflow-auto"
  >
    <slot name="tab-2" />
  </div>
  <div
    use:melt={$content(tabIds[2])}
    class="grow min-h-0 max-h-full overflow-auto"
  >
    <slot name="tab-3" />
  </div>
</div>
