<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SparkplugRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockSparkplugTreeState,
    mockSparkplugTreeStateUnresolved,
  } from "@/stories/fixtures";

  const componentName = "SparkplugRow";
  const storyId =
    "Views/Connection/DataView/MqttDataPanel/SparkplugPanel/SparkplugRow";
  const props: string[] = [
    "row",
    "nowMs",
    "onToggleExpansion",
    "onRequestRebirth",
    "onCopyMetricList",
  ];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const group = mockSparkplugTreeState.groups[0];
  const onlineNode = group.nodes.find((n) => n.name === "substation-7")!;
  const gapNode = group.nodes.find((n) => n.name === "substation-4")!;
  const offlineNode = group.nodes.find((n) => n.name === "substation-9")!;
  const unresolvedMetric =
    mockSparkplugTreeStateUnresolved.groups[0].nodes[0].metrics[0];

  const { Story } = defineMeta({
    // prettier-ignore
    title: "Views/Connection/DataView/MqttDataPanel/SparkplugPanel/SparkplugRow",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[680px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="NodeOnline" args={storyArgs} {template} />
<Story
  name="GroupRow"
  args={{
    ...storyArgs,
    row: { kind: "group", key: "EnergyCo", levelCount: 0, isExpanded: true, group },
  }}
  {template}
/>
<Story
  name="NodeSeqGap"
  args={{
    ...storyArgs,
    row: {
      kind: "node",
      key: "EnergyCo/substation-4",
      levelCount: 1,
      isExpanded: true,
      node: gapNode,
    },
  }}
  {template}
/>
<Story
  name="NodeOffline"
  args={{
    ...storyArgs,
    row: {
      kind: "node",
      key: "EnergyCo/substation-9",
      levelCount: 1,
      isExpanded: false,
      node: offlineNode,
    },
  }}
  {template}
/>
<Story
  name="DeviceRow"
  args={{
    ...storyArgs,
    row: {
      kind: "device",
      key: "EnergyCo/substation-7/meter-01",
      levelCount: 2,
      isExpanded: true,
      node: onlineNode,
      device: onlineNode.devices[0],
    },
  }}
  {template}
/>
<Story
  name="MetricRow"
  args={{
    ...storyArgs,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[0],
    },
  }}
  {template}
/>
<Story
  name="MetricStale"
  args={{
    ...storyArgs,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[3],
    },
  }}
  {template}
/>
<Story
  name="MetricUnresolved"
  args={{
    ...storyArgs,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-2",
      levelCount: 2,
      isExpanded: false,
      metric: unresolvedMetric,
    },
  }}
  {template}
/>
