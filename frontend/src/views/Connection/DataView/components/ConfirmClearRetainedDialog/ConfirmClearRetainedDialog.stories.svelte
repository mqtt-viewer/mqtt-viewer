<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ConfirmClearRetainedDialog.svelte";
  import { getStoryArgTypes } from "@/stories/fixtures";
  import { writable } from "svelte/store";

  const componentName = "ConfirmClearRetainedDialog";
  const props: string[] = ["topic", "count", "busy"];

  const { Story } = defineMeta({
    title: "Components/Connection/DataView/ConfirmClearRetainedDialog",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });

  const threeTopics = [
    "factory/line1/sensor1/temperature",
    "factory/line1/sensor2/temperature",
    "factory/line1/sensor3/temperature",
  ];

  const twentyFiveTopics = Array.from(
    { length: 25 },
    (_, i) => `factory/line1/sensor${i + 1}/temperature`
  );
</script>

{#snippet template(args: any)}
  <!-- Open by default so the story shows the dialog itself rather than a
       trigger. isOpen is a store, matching Dialog's contract. -->
  <Component {...args} isOpen={writable(true)} onConfirm={async () => {}} />
{/snippet}

<Story
  name="Single topic"
  args={{ topic: "factory/line1/sensor3/temperature", count: 0 }}
  {template}
/>

<Story
  name="Branch with 3 topics"
  args={{ topic: "factory/line1", count: 3, topics: threeTopics }}
  {template}
/>

<Story
  name="Branch with 25 topics"
  args={{ topic: "factory/line1", count: 25, topics: twentyFiveTopics }}
  {template}
/>

<Story
  name="Busy"
  args={{
    topic: "factory/line1",
    count: 3,
    topics: threeTopics,
    busy: true,
  }}
  {template}
/>
