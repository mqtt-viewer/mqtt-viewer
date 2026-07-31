<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./PayloadTab.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { createChartSeriesStore } from "./Chart/chart-series-store";

  const componentName = "PayloadTab";
  const storyId = "Views/Connection/DataView/SelectedTopicPanel/PayloadTab";
  const props: string[] = ["isComparing","payload","payloadLeftForCompare","payloadB64","codec","format"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // 1x1 red PNG — exercises the image-payload preview (issue #35)
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  // Backend-enriched Sparkplug NDATA payloads (names injected / alias-only).
  const SPARKPLUG_PAYLOAD = JSON.stringify({
    timestamp: "1752701530000",
    metrics: [
      { name: "Volts/L1", alias: "3", doubleValue: 239.9, timestamp: "1752701530000" },
      { name: "Amps/L1", alias: "5", doubleValue: 13.2, timestamp: "1752701530000" },
    ],
    seq: "42",
  });
  const SPARKPLUG_UNRESOLVED_PAYLOAD = JSON.stringify({
    timestamp: "1752701530000",
    metrics: [
      { alias: "3", doubleValue: 239.9, timestamp: "1752701530000" },
      { alias: "5", doubleValue: 13.2, timestamp: "1752701530000" },
    ],
    seq: "42",
  });

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/SelectedTopicPanel/PayloadTab",
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
  name="Image payload"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: "PNG…",
    payloadB64: TINY_PNG,
    format: "none",
  }}
  {template}
/>

<!-- A bare numeric payload is chartable; "Add value from payload" opens this
     picker directly on the value (issue #78). -->
<Story
  name="Chart fields (bare number)"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: "19",
    payloadB64: null,
    format: "none",
    chartSeriesStore: createChartSeriesStore([]),
    showFieldPicker: true,
  }}
  {template}
/>

<!-- Sparkplug decode banners (stateful Sparkplug feature). -->
<Story
  name="Sparkplug resolved"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: SPARKPLUG_PAYLOAD,
    payloadB64: null,
    format: "json-prettier",
    connectionId: 1,
    sparkplugMeta: {
      msgType: "NDATA",
      group: "EnergyCo",
      edgeNode: "substation-7",
      resolution: "resolved",
      birthAtMs: Date.now() - 45 * 60_000,
    },
  }}
  {template}
/>

<Story
  name="Sparkplug unresolved"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: SPARKPLUG_UNRESOLVED_PAYLOAD,
    payloadB64: null,
    format: "json-prettier",
    connectionId: 1,
    sparkplugMeta: {
      msgType: "NDATA",
      group: "EnergyCo",
      edgeNode: "substation-2",
      resolution: "unresolved",
    },
  }}
  {template}
/>

<Story
  name="Sparkplug birth"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: SPARKPLUG_PAYLOAD,
    payloadB64: null,
    format: "json-prettier",
    connectionId: 1,
    sparkplugMeta: {
      msgType: "NBIRTH",
      group: "EnergyCo",
      edgeNode: "substation-7",
      bdSeq: 3,
    },
  }}
  {template}
/>
