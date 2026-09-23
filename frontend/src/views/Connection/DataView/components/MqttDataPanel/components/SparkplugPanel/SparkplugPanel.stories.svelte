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
    mockSparkplugTreeStateReconnected,
    mockSparkplugTreeStateDisconnected,
  } from "@/stories/fixtures";

  const componentName = "SparkplugPanel";
  const storyId = "Views/Connection/DataView/MqttDataPanel/SparkplugPanel";
  const props: string[] = [
    "treeState",
    "width",
    "filter",
    "decodingState",
    "connectionState",
    "enablingDecoding",
    "onEnableDecoding",
    "onRequestRebirth",
    "onCopyMetricList",
    "onSelectMetric",
    "onCopyValue",
    "onClearWarnings",
    "onClearFilter",
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

{#snippet narrowTemplate(args: any)}
  <div class="h-[360px] w-[400px]">
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
  name="Reconnected"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateReconnected }}
  {template}
/>
<Story
  name="Disconnected"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateDisconnected }}
  {template}
/>
<Story
  name="DecodingOff"
  args={{ ...storyArgs, treeState: mockSparkplugTreeStateEmpty, decodingState: "off" }}
  {template}
/>
<Story
  name="NeedsReconnect"
  args={{
    ...storyArgs,
    treeState: mockSparkplugTreeStateEmpty,
    decodingState: "needs-reconnect",
  }}
  {template}
/>
<Story
  name="Filtered"
  args={{ ...storyArgs, treeState: mockSparkplugTreeState, filter: "volts" }}
  {template}
/>
<Story
  name="Narrow"
  args={{ ...storyArgs, width: 400 }}
  template={narrowTemplate}
/>
<Story
  name="DecodingOffDisconnected"
  args={{
    ...storyArgs,
    treeState: { ...mockSparkplugTreeStateEmpty, connected: false },
    decodingState: "off",
    connectionState: "disconnected",
  }}
  {template}
/>
<Story
  name="DecodingOffRetrying"
  args={{
    ...storyArgs,
    treeState: { ...mockSparkplugTreeStateEmpty, connected: false },
    decodingState: "off",
    connectionState: "reconnecting",
  }}
  {template}
/>
<Story
  name="PathSearch"
  args={{ ...storyArgs, treeState: mockSparkplugTreeState, filter: "spBv1.0/EnergyCo/NDATA/substation-4" }}
  {template}
/>
