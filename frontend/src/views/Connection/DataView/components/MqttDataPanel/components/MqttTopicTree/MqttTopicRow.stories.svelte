<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "MqttTopicRow";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree/MqttTopicRow";
  const props: string[] = ["topic","topicLevel","expandKey","message","messageCount","subtopicCount","isExpanded","isSelected","isDecodedProto","toggleExpansion","onTopicSelect","highlightedTopicStore","onOpenBrokerStatus","isRetained","isPinned","showChevron"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/MqttDataPanel/MqttTopicTree/MqttTopicRow",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={storyArgs} {template} />

<!-- A pinned row in the tree. The pin marker is the unpin button here too, so
     a pin can be undone from wherever the row is. -->
<Story
  name="Pinned"
  args={{ ...storyArgs, isPinned: true, onUnpin: () => {} }}
  {template}
/>

<!-- How the same row looks inside the pinned block: no chevron column, and the
     whole topic path as the label. -->
<Story
  name="Pinned block row"
  args={{
    ...storyArgs,
    isPinned: true,
    showChevron: false,
    topicLevel: "factory/line/temperature",
    onUnpin: () => {},
  }}
  {template}
/>
