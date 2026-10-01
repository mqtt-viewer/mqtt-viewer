<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicTree.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { createPinnedExpansionStore } from "@/views/Connection/DataView/stores/pinned-expansion";

  const componentName = "MqttTopicTree";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree";
  const props: string[] = ["width","selectedTopic","expandedTopicsStore","highlightedTopicStore","mqttData","searchText","sortKey","sortDir","onTopicSelect","pinnedTopics","onUnpin","onUnpinAll","pinnedExpansionStore","pinnedBodyCapPx","onPinnedBodyCapChange"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/MqttDataPanel/MqttTopicTree",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

<!-- The tree sizes itself from its container (the virtual lists and the
     pinned block's height cap both need a definite height), so give it one,
     as the data panel does in the app. -->
{#snippet template(args: any)}
  <div class="h-[420px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="Default" args={{ ...storyArgs, pinnedTopics: [] }} {template} />

<!-- Three pins, one of them a topic nothing has published on yet, which is
     what a pin persisted from a previous session looks like before the first
     message lands. -->
<Story name="With pinned topics" args={storyArgs} {template} />

<!-- A pinned branch opened in place: its children are listed beneath it by
     their last level, indented like the tree, and a nested pin keeps its pin
     marker. The tree below stays as it was, since the block keeps its own
     expansion. -->
<Story
  name="With an expanded pinned subtree"
  args={{
    ...storyArgs,
    pinnedTopics: ["factory", "factory/line/temperature", "warehouse/dock2/door"],
    pinnedExpansionStore: createPinnedExpansionStore(null, {
      factory: ["factory", "factory/line"],
    }),
  }}
  {template}
/>

<!-- One topic under two pins: factory/line is a row beneath factory and a
     pin of its own. Each pin keeps its own expansion, so it is closed under
     factory and open as a pin. -->
<Story
  name="Same topic under two pins"
  args={{
    ...storyArgs,
    pinnedTopics: ["factory", "factory/line"],
    pinnedExpansionStore: createPinnedExpansionStore(null, {
      factory: ["factory"],
      "factory/line": ["factory/line"],
    }),
  }}
  {template}
/>

<!-- The search filters the pinned block as it filters the tree. The header
     counts the pins it kept out of all of them, so the rest never look gone. -->
<Story
  name="With a search"
  args={{ ...storyArgs, searchText: "humidity" }}
  {template}
/>

<!-- The divider under the block was dragged to two rows. The block scrolls
     past that; hover the divider to see the handle, drag it to resize,
     double-click it (or press Enter on it) to go back to two fifths. -->
<Story
  name="With a resized pinned block"
  args={{
    ...storyArgs,
    pinnedTopics: ["factory", "warehouse/dock2/door"],
    pinnedExpansionStore: createPinnedExpansionStore(null, {
      factory: ["factory", "factory/line"],
    }),
    pinnedBodyCapPx: 38,
  }}
  {template}
/>
