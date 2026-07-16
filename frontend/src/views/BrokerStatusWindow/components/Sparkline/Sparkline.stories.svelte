<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./Sparkline.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockSparklinePoints,
  } from "@/stories/fixtures";

  const componentName = "Sparkline";
  const storyId = "Views/BrokerStatusWindow/Sparkline";
  const props: string[] = ["points", "height"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const now = Date.now();
  const flatPoints = Array.from({ length: 20 }, (_, i) => ({
    t: now - (19 - i) * 2000,
    v: 42,
  }));
  const spikyPoints = Array.from({ length: 30 }, (_, i) => ({
    t: now - (29 - i) * 2000,
    v: i % 7 === 3 ? 95 : 10 + (i % 5) * 4,
  }));
  const twoPoints = [
    { t: now - 2000, v: 10 },
    { t: now, v: 30 },
  ];

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/Sparkline",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[170px] text-primary">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="Rising" args={storyArgs} {template} />
<Story name="Flat" args={{ ...storyArgs, points: flatPoints }} {template} />
<Story name="Spiky" args={{ ...storyArgs, points: spikyPoints }} {template} />
<Story name="TwoPoints" args={{ ...storyArgs, points: twoPoints }} {template} />
<Story
  name="SinglePoint"
  args={{ ...storyArgs, points: [{ t: now, v: 5 }] }}
  {template}
/>
<Story name="Empty" args={{ ...storyArgs, points: [] }} {template} />
