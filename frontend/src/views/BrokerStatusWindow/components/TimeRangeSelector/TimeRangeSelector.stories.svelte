<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./TimeRangeSelector.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";

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

<Story
  name="Default"
  args={{ value: 5, options: [1, 5, 15] }}
  {template}
/>
<Story name="OneMinute" args={{ value: 1, options: [1, 5, 15] }} {template} />
<Story
  name="SparseNote"
  args={{
    value: 1,
    options: [1, 5, 15],
    sparseNote: "broker publishes about every 10s",
  }}
  {template}
/>
