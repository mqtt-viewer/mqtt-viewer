<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./TopicContextMenu.svelte";
  import ContextMenu from "@/components/ContextMenu/ContextMenu.svelte";
  import { getStoryArgTypes } from "@/stories/fixtures";

  const componentName = "TopicContextMenu";
  const props: string[] = [
    "topic",
    "hasPayload",
    "isRetained",
    "retainedBelowCount",
    "showHeader",
  ];

  const { Story } = defineMeta({
    title: "Components/Connection/DataView/TopicContextMenu",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });

  const noop = () => {};
  const actions = {
    onCopyTopic: noop,
    onCopyPayload: noop,
    onExport: noop,
    onClearRetained: noop,
    onClearRetainedBelow: noop,
  };
</script>

{#snippet template(args: any)}
  <!-- Rendered inside a real ContextMenu: TopicContextMenu emits menu items
       only, and DropdownMenuItem needs the melt "menu-elements" context that
       the surrounding menu provides. -->
  <div class="p-4 text-white-text">
    <ContextMenu>
      <div
        slot="trigger"
        class="flex h-24 w-80 items-center justify-center rounded border border-dashed border-secondary-text text-secondary-text"
      >
        Right-click to open the topic menu
      </div>
      <svelte:fragment slot="menu-content">
        <Component {...args} {...actions} />
      </svelte:fragment>
    </ContextMenu>
  </div>
{/snippet}

<Story
  name="Leaf with retained message"
  args={{
    topic: "factory/line1/sensor3/temperature",
    hasPayload: true,
    isRetained: true,
    retainedBelowCount: 0,
  }}
  {template}
/>

<Story
  name="Leaf without retained message"
  args={{
    topic: "factory/line1/sensor3/temperature",
    hasPayload: true,
    isRetained: false,
    retainedBelowCount: 0,
  }}
  {template}
/>

<Story
  name="Branch node"
  args={{
    topic: "factory/line1",
    hasPayload: false,
    isRetained: false,
    retainedBelowCount: 12,
  }}
  {template}
/>

<Story
  name="Long topic path"
  args={{
    topic:
      "factory/line1/cell4/station7/sensor3/measurements/temperature/celsius",
    hasPayload: true,
    isRetained: true,
    retainedBelowCount: 1,
  }}
  {template}
/>
