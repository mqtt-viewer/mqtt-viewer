<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./HealthChip.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";

  const componentName = "HealthChip";

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/HealthChip",
    component: Component,
    tags: ["autodocs"],
    argTypes: {
      level: { control: "select", options: ["ok", "attention", "problem"] },
    },
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story
  name="Ok"
  args={{ label: "Store", level: "ok", qualifier: "", valueText: "1.3k" }}
  {template}
/>
<Story
  name="Attention"
  args={{
    label: "Delivery backlog",
    level: "attention",
    qualifier: "rising",
    valueText: "340",
  }}
  {template}
/>
<Story
  name="Problem"
  args={{
    label: "Drops",
    level: "problem",
    qualifier: "rising",
    valueText: "12.4/s",
  }}
  {template}
/>
<Story
  name="Informational"
  args={{
    label: "Heap",
    level: null,
    informational: true,
    qualifier: "",
    valueText: "8.6M (peak 9.1M)",
  }}
  {template}
/>
<Story
  name="Stale"
  args={{
    label: "Drops",
    level: "problem",
    qualifier: "rising",
    valueText: "12.4/s",
    stale: true,
  }}
  {template}
/>
