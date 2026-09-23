<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttGraphView.svelte";
  import type { GraphMessageSource } from "./MqttGraphView.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    createStaticPinnedTopicsStore,
    getStoryArgTypes,
    getStoryArgs,
  } from "@/stories/fixtures";
  import { startMockMessages } from "./mock-source";

  const componentName = "MqttGraphView";
  const storyId = "Views/Connection/DataView/MqttGraphView";
  const props: string[] = [
    "connection",
    "selectedTopicStore",
    "pinnedTopicsStore",
    "width",
  ];

  // live synthetic traffic so the story shows the graph in motion
  const mockMessageSource: GraphMessageSource = {
    subscribe: (onMessages) => {
      const handle = startMockMessages((topic, timeMs) =>
        onMessages([{ topic, timeMs }])
      );
      return handle.stop;
    },
  };

  const storyArgs = {
    ...getStoryArgs(storyId, componentName, props),
    messageSource: mockMessageSource,
  };

  // Real topics from mock-source, one of each kind the overlay has to tell
  // apart: two leaves that publish payloads, and "house/livingroom", which
  // publishes and also has children under it.
  const pinnedTopics = [
    "backyard/sensors/34/temperature",
    "house/livingroom",
    "garden/soil/moisture",
  ];

  // The mock source emits topics, not payloads, so the story supplies the
  // payload the overlay would otherwise read off the message history. Null for
  // the branch, so its "N topics · M msgs" line renders too.
  const mockPayloads: Record<string, string> = {
    "backyard/sensors/34/temperature": '{"temp":21.4,"unit":"C"}',
    "garden/soil/moisture": '{"moisture":0.38}',
  };

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/MqttGraphView",
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

<!-- Three pinned topics: the square markers on the nodes, pinned branches
     sorted before their siblings, and the Pinned overlay listing each one with
     its current value. -->
<Story
  name="Pinned"
  args={{
    ...storyArgs,
    pinnedTopicsStore: createStaticPinnedTopicsStore(pinnedTopics),
    getTopicPayload: (topic: string) => mockPayloads[topic] ?? null,
  }}
  {template}
/>
