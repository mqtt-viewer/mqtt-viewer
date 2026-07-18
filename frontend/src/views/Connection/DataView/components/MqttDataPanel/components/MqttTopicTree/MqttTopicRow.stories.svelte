<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "MqttTopicRow";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree/MqttTopicRow";
  const props: string[] = ["topic","topicLevel","expandKey","message","messageCount","subtopicCount","isExpanded","isSelected","protoDecode","protoDescriptorName","toggleExpansion","onTopicSelect","highlightedTopicStore","onOpenBrokerStatus"];
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
<Story
  name="DecodedOk"
  args={{ ...storyArgs, protoDecode: "ok", protoDescriptorName: "mqtt.viewer.DeviceState" }}
  {template}
/>
<Story
  name="DecodedFailed"
  args={{ ...storyArgs, protoDecode: "failed", protoDescriptorName: "mqtt.viewer.DeviceState" }}
  {template}
/>
