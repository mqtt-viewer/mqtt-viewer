<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicTree.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { createPinnedExpansionStore } from "@/views/Connection/DataView/stores/pinned-expansion";

  const componentName = "MqttTopicTree";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree";
  const props: string[] = ["width","selectedTopic","expandedTopicsStore","highlightedTopicStore","mqttData","searchText","sortKey","sortDir","onTopicSelect","pinnedTopics","onUnpin","onUnpinAll","pinnedExpansionStore"];
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
     pinned block's two-fifths cap both need a definite height), so give it
     one, as the data panel does in the app. -->
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
    pinnedExpansionStore: createPinnedExpansionStore(null, [
      "factory",
      "factory/line",
    ]),
  }}
  {template}
/>
