<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./FactsRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";

  const componentName = "FactsRow";

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/FactsRow",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story
  name="Full"
  args={{
    version: "mosquitto 2.0.18",
    uptimeSeconds: 273600,
    clientsConnected: 17,
    clientsDisconnected: 6,
    clientsExpired: 2,
    avgMsgSize: 312,
  }}
  {template}
/>
<Story
  name="PartialSessions"
  args={{
    version: "EMQX 5.4.1",
    uptimeSeconds: 90000,
    clientsConnected: 42,
    clientsDisconnected: null,
    clientsExpired: null,
    avgMsgSize: null,
  }}
  {template}
/>
<Story
  name="VersionOnly"
  args={{ version: "VerneMQ 1.13.0" }}
  {template}
/>
