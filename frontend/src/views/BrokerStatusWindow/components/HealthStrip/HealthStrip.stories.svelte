<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./HealthStrip.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { mockHealthChips, mockBrokerFacts } from "@/stories/fixtures";

  const componentName = "HealthStrip";

  // A broker that publishes no $SYS at all: no chips, no facts, no bar.
  const noFacts = {
    version: null,
    uptimeSeconds: null,
    clientsConnected: null,
    clientsDisconnected: null,
    clientsExpired: null,
    avgMsgSize: null,
  };

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

<Story
  name="AllStates"
  args={{ health: mockHealthChips(), facts: mockBrokerFacts() }}
  {template}
/>
<Story
  name="WithStale"
  args={{ health: withStale(), facts: mockBrokerFacts() }}
  {template}
/>
<Story
  name="SkipsUnrendered"
  args={{ health: withUnrendered(), facts: mockBrokerFacts() }}
  {template}
/>
<!-- A broker with health signals but no facts published yet. -->
<Story name="ChipsOnly" args={{ health: mockHealthChips() }} {template} />
<!-- A broker with $SYS facts but no chip that has reached its minimum samples:
     the bar still earns its place. -->
<Story
  name="FactsOnly"
  args={{ health: [], facts: mockBrokerFacts() }}
  {template}
/>
<Story name="Empty" args={{ health: [], facts: noFacts }} {template} />

<!-- The bar is as wide as the window, so the two widths that decide the layout
     are read directly here, inside a mock of the sticky wrapper's padding and
     border. At 1440 the facts finish the chip line; at 760 they drop whole onto
     the next line. Neither may overflow horizontally. -->
{#snippet bar(args: any, width: string)}
  <div class="bg-elevation-0" style:width>
    <div class="border-b border-outline px-4 py-3">
      <Component {...args} />
    </div>
  </div>
{/snippet}

{#snippet wide(args: any)}
  {@render bar(args, "1440px")}
{/snippet}

{#snippet narrow(args: any)}
  {@render bar(args, "760px")}
{/snippet}

<Story
  name="BarAt1440"
  args={{ health: mockHealthChips(), facts: mockBrokerFacts() }}
  template={wide}
/>
<Story
  name="BarAt760"
  args={{ health: mockHealthChips(), facts: mockBrokerFacts() }}
  template={narrow}
/>
