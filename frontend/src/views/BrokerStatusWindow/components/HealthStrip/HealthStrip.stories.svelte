<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./HealthStrip.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { mockHealthChips } from "@/stories/fixtures";

  const componentName = "HealthStrip";

  // A stale variant: silence greys the value and drops the dot + qualifier.
  const withStale = () => {
    const chips = mockHealthChips();
    return chips.map((c) =>
      c.id === "drops" ? { ...c, stale: true, qualifier: "" } : c
    );
  };

  // Below-minimum chips (render:false) must be skipped entirely.
  const withUnrendered = () =>
    mockHealthChips().map((c) =>
      c.id === "churn" ? { ...c, render: false } : c
    );

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/HealthStrip",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="AllStates" args={{ health: mockHealthChips() }} {template} />
<Story name="WithStale" args={{ health: withStale() }} {template} />
<Story name="SkipsUnrendered" args={{ health: withUnrendered() }} {template} />
<Story name="Empty" args={{ health: [] }} {template} />
