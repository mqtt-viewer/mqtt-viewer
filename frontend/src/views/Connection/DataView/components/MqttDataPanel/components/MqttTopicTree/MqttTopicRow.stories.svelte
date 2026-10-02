<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttTopicRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "MqttTopicRow";
  const storyId = "Views/Connection/DataView/MqttDataPanel/MqttTopicTree/MqttTopicRow";
  const props: string[] = ["topic","topicLevel","expandKey","message","messageCount","subtopicCount","isExpanded","isSelected","isDecodedProto","isProtoDecodeFailed","protoDescriptorName","toggleExpansion","onTopicSelect","highlightedTopicStore","onOpenBrokerStatus","isRetained","isPinned","onUnpin"];
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

<!-- Decoded by a protobuf binding; the marker's title names the type. -->
<Story
  name="DecodedOk"
  args={{ ...storyArgs, isDecodedProto: true, protoDescriptorName: "mqtt.viewer.DeviceState" }}
  {template}
/>

<!-- A binding claimed the topic but the payload didn't decode as its type. -->
<Story
  name="DecodedFailed"
  args={{ ...storyArgs, isProtoDecodeFailed: true, protoDescriptorName: "mqtt.viewer.DeviceState" }}
  {template}
/>

<!-- A pinned row in the tree. The pin marker is the unpin button here too, so
     a pin can be undone from wherever the row is. -->
<Story
  name="Pinned"
  args={{ ...storyArgs, isPinned: true, onUnpin: () => {} }}
  {template}
/>

<!-- How a pin looks at the top of the pinned block: the whole topic path as
     the label. A pinned branch keeps its chevron so it can open in place. -->
<Story
  name="Pinned block row"
  args={{
    ...storyArgs,
    isPinned: true,
    isExpanded: false,
    topic: "factory/line",
    expandKey: "factory/line",
    topicLevel: "factory/line",
    subtopicCount: 2,
    message: undefined,
    messageCount: 0,
    onUnpin: () => {},
  }}
  {template}
/>
