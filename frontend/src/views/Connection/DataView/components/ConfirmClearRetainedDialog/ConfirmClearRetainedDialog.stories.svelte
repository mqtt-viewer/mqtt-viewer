<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ConfirmClearRetainedDialog.svelte";
  import { getStoryArgTypes } from "@/stories/fixtures";
  import { writable } from "svelte/store";

  const componentName = "ConfirmClearRetainedDialog";
  const props: string[] = ["topic", "count"];

  const { Story } = defineMeta({
    title: "Components/Connection/DataView/ConfirmClearRetainedDialog",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <!-- Open by default so the story shows the dialog itself rather than a
       trigger. isOpen is a store, matching Dialog's contract. -->
  <Component {...args} isOpen={writable(true)} onConfirm={() => {}} />
{/snippet}

<Story
  name="Single topic"
  args={{ topic: "factory/line1/sensor3/temperature", count: 0 }}
  {template}
/>

<Story name="Branch" args={{ topic: "factory/line1", count: 12 }} {template} />

<Story
  name="Branch with one message"
  args={{ topic: "factory/line1", count: 1 }}
  {template}
/>
