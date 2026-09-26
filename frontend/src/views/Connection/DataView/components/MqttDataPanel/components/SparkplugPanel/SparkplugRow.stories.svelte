<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SparkplugRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockSparkplugTreeState,
    mockSparkplugTreeStateUnresolved,
    mockSparkplugTreeStateReconnected,
  } from "@/stories/fixtures";

  const componentName = "SparkplugRow";
  const storyId =
    "Views/Connection/DataView/MqttDataPanel/SparkplugPanel/SparkplugRow";
  const props: string[] = [
    "row",
    "nowMs",
    "domId",
    "isSelected",
    "isActive",
    "treeFocused",
    "isHighlighted",
    "compact",
    "connected",
    "onActivate",
    "onRequestRebirth",
    "onCopyMetricList",
    "onCopyValue",
  ];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const group = mockSparkplugTreeState.groups[0];
  const onlineNode = group.nodes.find((n) => n.name === "substation-7")!;
  const gapNode = group.nodes.find((n) => n.name === "substation-4")!;
  const offlineNode = group.nodes.find((n) => n.name === "substation-9")!;
  const unresolvedNode = mockSparkplugTreeStateUnresolved.groups[0].nodes[0];
  const unresolvedMetric = unresolvedNode.metrics[0];
  const unknownNode = mockSparkplugTreeStateReconnected.groups[0].nodes[1];

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

{#snippet narrowTemplate(args: any)}
  <div class="w-[360px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="NodeOnline" args={storyArgs} {template} />
<Story
  name="GroupRow"
  args={{
    ...storyArgs,
    row: { kind: "group", key: "EnergyCo", id: "EnergyCo", index: 0, levelCount: 0, isExpanded: true, group },
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
      id: "EnergyCo/substation-4",
      index: 0,
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
      id: "EnergyCo/substation-9",
      index: 0,
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
      id: "EnergyCo/substation-7/meter-01",
      index: 0,
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
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[0],
    },
  }}
  {template}
/>
<Story
  name="MetricBadQuality"
  args={{
    ...storyArgs,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[4],
    },
  }}
  {template}
/>
<Story
  name="MetricArray"
  args={{
    ...storyArgs,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[2],
    },
  }}
  {template}
/>
<Story
  name="MetricSelected"
  args={{
    ...storyArgs,
    isSelected: true,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[3],
    },
  }}
  {template}
/>
<Story
  name="NodeNoBirth"
  args={{
    ...storyArgs,
    row: {
      kind: "node",
      key: "EnergyCo/substation-2",
      id: "EnergyCo/substation-2",
      index: 0,
      levelCount: 1,
      isExpanded: true,
      node: unresolvedNode,
    },
  }}
  {template}
/>
<Story
  name="NodeUnknownAfterDrop"
  args={{
    ...storyArgs,
    row: {
      kind: "node",
      key: "EnergyCo/substation-8",
      id: "EnergyCo/substation-8",
      index: 0,
      levelCount: 1,
      isExpanded: true,
      node: unknownNode,
    },
  }}
  {template}
/>
<Story
  name="DeviceAwaitingBirth"
  args={{
    ...storyArgs,
    row: {
      kind: "device",
      key: "EnergyCo/substation-8/meter-02",
      id: "EnergyCo/substation-8/meter-02",
      index: 0,
      levelCount: 2,
      isExpanded: true,
      node: unknownNode,
      device: unknownNode.devices[0],
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
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: unresolvedMetric,
    },
  }}
  {template}
/>
<Story
  name="NodeKeyboardCursor"
  args={{ ...storyArgs, isActive: true, treeFocused: true }}
  {template}
/>
<Story
  name="NodeCompact"
  args={{
    ...storyArgs,
    compact: true,
    row: {
      kind: "node",
      key: "EnergyCo/substation-4",
      id: "EnergyCo/substation-4",
      index: 0,
      levelCount: 1,
      isExpanded: true,
      node: gapNode,
    },
  }}
  template={narrowTemplate}
/>
<Story
  name="MetricCompact"
  args={{
    ...storyArgs,
    compact: true,
    row: {
      kind: "metric",
      key: "EnergyCo/substation-7",
      id: "metric-story",
      index: 0,
      levelCount: 2,
      isExpanded: false,
      metric: onlineNode.metrics[4],
    },
  }}
  template={narrowTemplate}
/>
<Story
  name="NodeDisconnected"
  args={{ ...storyArgs, connected: false, isActive: true, treeFocused: true }}
  {template}
/>
