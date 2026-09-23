<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ConfirmRebirthDialog.svelte";
  import { getStoryArgTypes } from "@/stories/fixtures";
  import { writable } from "svelte/store";

  const componentName = "ConfirmRebirthDialog";
  const props: string[] = ["busy"];

  const { Story } = defineMeta({
    title: "Components/Connection/DataView/ConfirmRebirthDialog",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });

  const fleet = Array.from({ length: 14 }, (_, i) => ({
    group: "EnergyCo",
    node: `substation-${i + 1}`,
  }));
</script>

{#snippet template(args: any)}
  <!-- Open by default so the story shows the dialog itself. -->
  <Component {...args} isOpen={writable(true)} onConfirm={async () => {}} />
{/snippet}

<Story
  name="Single node"
  args={{ targets: [{ group: "EnergyCo", node: "substation-4" }] }}
  {template}
/>

<Story name="Many nodes" args={{ targets: fleet }} {template} />

<Story
  name="Busy"
  args={{ targets: fleet.slice(0, 3), busy: true }}
  {template}
/>
