<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./StatTile.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockSparklinePoints,
  } from "@/stories/fixtures";

  const componentName = "StatTile";
  const storyId = "Views/BrokerStatusWindow/StatTile";
  const props: string[] = ["label", "value", "unit", "points", "noData"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/StatTile",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[190px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="Default" args={storyArgs} {template} />
<Story
  name="LargeSIValue"
  args={{
    ...storyArgs,
    label: "Bytes/s out",
    value: "3.4M",
    unit: "B/s",
    points: mockSparklinePoints,
  }}
  {template}
/>
<Story
  name="NoSparkline"
  args={{
    ...storyArgs,
    label: "Connected clients",
    value: "17",
    unit: undefined,
    points: undefined,
  }}
  {template}
/>
<Story
  name="StringValue"
  args={{
    ...storyArgs,
    label: "Broker",
    value: "mosquitto 2.0.18",
    unit: undefined,
    points: undefined,
  }}
  {template}
/>
<Story
  name="LongStringValue"
  args={{
    ...storyArgs,
    label: "Broker version",
    value: "mosquitto version 2.0.18",
    unit: undefined,
    points: undefined,
  }}
  {template}
/>
<Story
  name="NoData"
  args={{
    ...storyArgs,
    label: "Retained msgs",
    value: "",
    unit: undefined,
    points: undefined,
    noData: true,
  }}
  {template}
/>
