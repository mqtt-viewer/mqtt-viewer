<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MemoryFormula.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "MemoryFormula";
  const storyId = "Components/MemoryFormula";
  const props: string[] = ["budgetMb"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Components/MemoryFormula",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={storyArgs} {template} />
