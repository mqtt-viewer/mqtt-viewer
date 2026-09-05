<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./TimeRangeSelector.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { PRESET_MINUTES } from "./time-range";

  const componentName = "TimeRangeSelector";

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/TimeRangeSelector",
    component: Component,
    tags: ["autodocs"],
    argTypes: {
      value: { control: { type: "number" } },
    },
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={{ value: 5, options: PRESET_MINUTES }} {template} />
<Story
  name="OneMinute"
  args={{ value: 1, options: PRESET_MINUTES }}
  {template}
/>
<!-- A window outside the presets: the custom segment is selected and reads
     back the live interval. -->
<Story
  name="Custom"
  args={{ value: 120, options: PRESET_MINUTES }}
  {template}
/>
<Story
  name="SparseNote"
  args={{
    value: 1,
    options: PRESET_MINUTES,
    sparseNote: "broker publishes about every 10s",
  }}
  {template}
/>
