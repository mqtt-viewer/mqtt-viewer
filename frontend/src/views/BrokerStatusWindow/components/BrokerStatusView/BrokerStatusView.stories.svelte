<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./BrokerStatusView.svelte";
  import {
    initializeStorybookStores,
    createMockBrokerStatusStore,
    createMockBrokerStatusEmptyStore,
    createMockBrokerStatusDisconnectedStore,
  } from "@/stories/fixtures";

  initializeStorybookStores();

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/BrokerStatusView",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[760px] max-w-full bg-elevation-0 p-4">
    <Component {...args} />
  </div>
{/snippet}

<Story
  name="Populated"
  args={{ store: createMockBrokerStatusStore(), connectionId: 1 }}
  {template}
/>

<Story
  name="EmptyStateWithCTA"
  args={{ store: createMockBrokerStatusEmptyStore(), connectionId: 1 }}
  {template}
/>

<Story
  name="Disconnected"
  args={{ store: createMockBrokerStatusDisconnectedStore(), connectionId: 2 }}
  {template}
/>
