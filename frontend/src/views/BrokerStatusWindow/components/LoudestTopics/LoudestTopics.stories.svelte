<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./LoudestTopics.svelte";
  import { mockLoudest } from "@/stories/fixtures";

  const collecting = () => ({ ...mockLoudest(), collecting: true });
  const noOverflow = () => ({
    ...mockLoudest(),
    overflowTopics: 0,
    overflowMsgPerSec: 0,
  });
  const empty = () => ({
    rows: [],
    overflowTopics: 0,
    overflowMsgPerSec: 0,
    collecting: true,
  });
  // Deep topics with long segments: the head ellipsises, the last two segments
  // survive. The last row is a single very long leaf, the case the tail's
  // max-width guards.
  const longTopic = () => ({
    ...mockLoudest(),
    rows: [
      {
        topic:
          "manufacturing/site-rotterdam/building-north/line-04/station-12/press/hydraulic-pressure",
        msgPerSec: 214.6,
        bytesPerSec: 9400,
      },
      {
        topic:
          "telemetry/region/eu-west-1/availability-zone-c/gateway/0742/downstream/metrics",
        msgPerSec: 88.2,
        bytesPerSec: 6100,
      },
      {
        topic:
          "devices/a-single-extremely-long-leaf-segment-that-cannot-be-shortened-at-all",
        msgPerSec: 12.4,
        bytesPerSec: 320,
      },
    ],
  });

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/LoudestTopics",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[640px] max-w-full bg-elevation-0 p-4">
    <Component {...args} />
  </div>
{/snippet}

{#snippet narrow(args: any)}
  <div class="w-[300px] bg-elevation-0 p-4">
    <Component {...args} />
  </div>
{/snippet}

<Story name="Populated" args={{ loudest: mockLoudest(), expanded: true }} {template} />
<Story name="Collapsed" args={{ loudest: mockLoudest(), expanded: false }} {template} />
<Story name="Collecting" args={{ loudest: collecting(), expanded: true }} {template} />
<Story name="NoOverflow" args={{ loudest: noOverflow(), expanded: true }} {template} />
<Story name="LongTopic" args={{ loudest: longTopic(), expanded: true }} {template} />
<Story name="Narrow" args={{ loudest: mockLoudest(), expanded: true }} template={narrow} />
<Story name="Empty" args={{ loudest: empty(), expanded: true }} {template} />
