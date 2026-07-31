<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SparkplugPanel.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockSparkplugTreeState,
    mockSparkplugTreeStateEmpty,
    mockSparkplugTreeStateUnresolved,
    mockSparkplugTreeStateHostOffline,
  } from "@/stories/fixtures";

  const componentName = "SparkplugPanel";
  const storyId = "Views/Connection/DataView/MqttDataPanel/SparkplugPanel";
  const props: string[] = [
    "treeState",
    "width",
    "filter",
    "onRequestRebirth",
    "onCopyMetricList",
  ];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    // prettier-ignore
    title: "Views/Connection/DataView/MqttDataPanel/SparkplugPanel",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="h-[360px] w-[700px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="Default" args={storyArgs} {template} />
<Story
  name="Empty"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateEmpty }}
  {template}
/>
<Story
  name="Unresolved"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateUnresolved }}
  {template}
/>
<Story
  name="Warnings"
  args={{ ...storyArgs, treeState: mockSparkplugTreeState }}
  {template}
/>
<Story
  name="HostOffline"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateHostOffline }}
  {template}
/>
<Story
  name="Filtered"
  args={{ ...storyArgs, treeState: mockSparkplugTreeState, filter: "volts" }}
  {template}
/>
