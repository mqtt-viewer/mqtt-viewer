<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SavedMessageRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "SavedMessageRow";
  const storyId = "Views/Connection/DataView/Sidebar/SavedMessageRow";
  const props: string[] = ["message","collectionsStore","onOpenMessage"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/Sidebar/SavedMessageRow",
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
