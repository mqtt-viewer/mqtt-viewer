<script lang="ts">
  import { onMount, setContext } from "svelte";
  import { writable } from "svelte/store";
  import { createTreeView } from "@melt-ui/svelte";
  import { setConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { setConnectionIsValidContext } from "@/views/Connection/contexts/connection-is-valid";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import { getStoryChildren, initializeStorybookStores } from "./fixtures";

  export let component: any;
  export let args: Record<string, unknown> = {};
  export let componentName: string;

  setConnectionIdContext(1);
  setConnectionIsValidContext(writable(true));
  setContext("tree", createTreeView({ expanded: writable([]) }));

  const cloneMqttData = (data: Record<string, any>): Record<string, any> => {
    return Object.fromEntries(
      Object.entries(data ?? {}).map(([key, value]) => [
        key,
        {
          ...value,
          latestMessageTime: value.latestMessageTime
            ? new Date(value.latestMessageTime)
            : value.latestMessageTime,
          children: cloneMqttData(value.children ?? {}),
        },
      ])
    );
  };

  $: renderArgs = {
    ...args,
    ...(args.mqttData ? { mqttData: cloneMqttData(args.mqttData as any) } : {}),
  };

  onMount(() => {
    initializeStorybookStores();
  });
</script>

<div class="min-h-[180px] size-full bg-elevation-0 p-5 text-white-text">
  {#if componentName === "Dialog"}
    <svelte:component this={component} {...renderArgs}>
      <span slot="trigger" class="rounded bg-button px-3 py-2">Open dialog</span
      >
      <div class="min-w-[320px]">Dialog content prepared for Storybook.</div>
    </svelte:component>
  {:else if componentName === "DropdownMenu"}
    <svelte:component this={component} {...renderArgs}>
      <span slot="trigger" class="rounded bg-button px-3 py-2">Actions</span>
      <div slot="menu-content" class="flex flex-col gap-1 p-2">
        <button class="rounded px-3 py-1 text-left hover:bg-elevation-2-hover">
          Publish
        </button>
        <button class="rounded px-3 py-1 text-left hover:bg-elevation-2-hover">
          Duplicate
        </button>
      </div>
    </svelte:component>
  {:else if componentName === "Tabs"}
    <svelte:component
      this={component}
      {...renderArgs}
      class="h-[260px] w-[520px]"
    >
      <div slot="tab-1" class="p-4">Payload tab content</div>
      <div slot="tab-2" class="p-4">Header tab content</div>
      <div slot="tab-3" class="p-4">User properties content</div>
    </svelte:component>
  {:else if componentName === "Tooltip"}
    <svelte:component this={component} {...renderArgs}>
      <button class="rounded bg-button px-3 py-2">Hover target</button>
      <span slot="tooltip-content">Tooltip content</span>
    </svelte:component>
  {:else if componentName === "DialogActionBar"}
    <svelte:component this={component} {...renderArgs}>
      <button class="rounded bg-button px-3 py-2">Cancel</button>
      <button class="rounded bg-primary px-3 py-2 text-black">Save</button>
    </svelte:component>
  {:else if componentName === "DropdownMenuItem"}
    <DropdownMenu>
      <span slot="trigger" class="rounded bg-button px-3 py-2">Actions</span>
      <div slot="menu-content" class="flex flex-col gap-1 p-2">
        <svelte:component this={component} {...renderArgs}>
          {getStoryChildren(componentName)}
        </svelte:component>
      </div>
    </DropdownMenu>
  {:else if componentName === "DropdownCloseOnClick"}
    <DropdownMenu>
      <span slot="trigger" class="rounded bg-button px-3 py-2">Actions</span>
      <div slot="menu-content" class="flex flex-col gap-1 p-2">
        <svelte:component this={component} {...renderArgs}>
          <button class="rounded bg-button px-3 py-2">Close on click</button>
        </svelte:component>
      </div>
    </DropdownMenu>
  {:else if componentName === "HeaderRow"}
    <svelte:component this={component} {...renderArgs}>
      <span slot="key">Content Type</span>
      <span slot="value">application/json</span>
    </svelte:component>
  {:else}
    <svelte:component this={component} {...renderArgs}>
      {getStoryChildren(componentName)}
    </svelte:component>
  {/if}
</div>
