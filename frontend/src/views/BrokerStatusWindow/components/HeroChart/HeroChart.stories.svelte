<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./HeroChart.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import type { HeroSeries } from "./hero-chart-option";

  const componentName = "HeroChart";

  // Series anchored to load time (same approach as stories/fixtures.ts): the
  // component's window slides with Date.now(), so points anchored to a fixed
  // past timestamp would fall outside it and render an empty chart. The sine
  // shapes stay deterministic; only the anchor moves.
  const NOW = Date.now();

  // A gently varying msgs/s series across the last `windowMinutes`, one sample
  // per second, offset and scaled per series so the three lines read apart.
  const buildSeries = (
    id: string,
    label: string,
    base: number,
    amp: number,
    dashed: boolean,
    tooltip: string,
    emphasis = false,
    windowMinutes = 5,
    gapAt?: number
  ): HeroSeries => {
    const count = windowMinutes * 60;
    const points = Array.from({ length: count }, (_, i) => {
      const t = NOW - (count - 1 - i) * 1000;
      const v = gapAt !== undefined && i === gapAt
        ? null
        : Math.max(0, base + Math.sin(i / 12 + base) * amp);
      return { t, v };
    });
    return { id, label, points, dashed, emphasis, tooltip };
  };

  const inOut = (windowMinutes = 5): HeroSeries[] => [
    buildSeries(
      "in",
      "In",
      42,
      10,
      false,
      "1 min average, from the broker; 5m: 40, 15m: 38",
      true,
      windowMinutes
    ),
    buildSeries(
      "out",
      "Out",
      58,
      12,
      false,
      "1 min average, from the broker; 5m: 55, 15m: 52",
      false,
      windowMinutes
    ),
    buildSeries(
      "observed",
      "Observed",
      36,
      8,
      true,
      "this second, as received by this client",
      false,
      windowMinutes,
      120
    ),
  ];

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/HeroChart",
    component: Component,
    tags: ["autodocs"],
    argTypes: {
      windowMinutes: { control: { type: "number" } },
      height: { control: { type: "number" } },
    },
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[560px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story
  name="InOutObserved"
  args={{ series: inOut(5), windowMinutes: 5, height: 160 }}
  {template}
/>
<Story
  name="ObservedOnly"
  args={{
    series: [
      buildSeries(
        "observed",
        "Observed",
        36,
        8,
        false,
        "this second, as received by this client"
      ),
    ],
    windowMinutes: 5,
    height: 160,
  }}
  {template}
/>
<Story
  name="OneMinuteWindow"
  args={{ series: inOut(1), windowMinutes: 1, height: 160 }}
  {template}
/>
