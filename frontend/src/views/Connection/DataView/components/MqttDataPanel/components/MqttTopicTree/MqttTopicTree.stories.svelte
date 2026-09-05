<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicTree.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "MqttTopicTree";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree";
  const props: string[] = ["width","selectedTopic","expandedTopicsStore","highlightedTopicStore","mqttData","searchText","sortKey","sortDir","onTopicSelect","pinnedTopics","onUnpin","onUnpinAll"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/MqttDataPanel/MqttTopicTree",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={{ ...storyArgs, pinnedTopics: [] }} {template} />

<!-- Three pins, one of them a topic nothing has published on yet, which is
     what a pin persisted from a previous session looks like before the first
     message lands. -->
<Story name="With pinned topics" args={storyArgs} {template} />
