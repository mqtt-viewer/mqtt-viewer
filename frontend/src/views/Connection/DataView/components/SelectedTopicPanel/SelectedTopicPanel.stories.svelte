<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SelectedTopicPanel.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "SelectedTopicPanel";
  const storyId = "Views/Connection/DataView/SelectedTopicPanel";
  const props: string[] = ["connectionId","selectedTopicStore","firstConnectedAtMs","mqttVersion","deleteRetainedMessage","exportTopicMessages","openChartWindow","dockMode","onSetDockMode","showCloseButton"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/SelectedTopicPanel",
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

<!-- Dock side "right" (default, narrow width): matches DataView's ResizableContainer
     resizeEdge="left" placement, the current/unchanged docked-right layout. -->
<Story
  name="DockedRight"
  args={{ ...storyArgs, dockMode: "right" }}
  {template}
/>

<!-- Dock side "bottom" (wide, short): matches DataView's ResizableContainer
     resizeEdge="top" placement, so MessageTimeline/tabs/ChartView can be
     reviewed at wide-and-short proportions. -->
<Story
  name="DockedBottom"
  args={{ ...storyArgs, dockMode: "bottom" }}
  {template}
/>
