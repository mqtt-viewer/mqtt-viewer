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

<!-- The title bar gives it whatever room the window title leaves, so the whole
     line has to ellipsise rather than push the header wide. -->
{#snippet narrow(args: any)}
  <div class="flex w-[260px] bg-elevation-0 p-2">
    <Component {...args} />
  </div>
{/snippet}

<Story
  name="Narrow"
  args={{
    version: "mosquitto version 2.1.2",
    uptimeSeconds: 1854600,
    clientsConnected: 10,
    clientsDisconnected: 0,
    clientsExpired: 0,
    avgMsgSize: 84.3,
  }}
  template={narrow}
/>
