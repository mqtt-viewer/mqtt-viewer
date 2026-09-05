<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MqttGraphView.svelte";
  import type { GraphMessageSource } from "./MqttGraphView.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { startMockMessages } from "./mock-source";

  const componentName = "MqttGraphView";
  const storyId = "Views/Connection/DataView/MqttGraphView";
  const props: string[] = ["connection", "selectedTopicStore", "width"];

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