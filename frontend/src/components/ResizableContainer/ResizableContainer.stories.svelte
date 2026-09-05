<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ResizableContainer.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "ResizableContainer";
  const storyId = "Primitives/ResizableContainer";
  const props: string[] = ["id","collapsed","minSize","maxSize","resizeEdge","defaultSize","width","height"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Primitives/ResizableContainer",
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

<!-- Vertical (bottom-dock) example: sizes height instead of width, drag
     handle along the top edge. Mirrors the dockable topic panel's
     resizeEdge="top" usage in DataView. defaultSize sets the rendered
     height (the height prop is an output binding, not an input), and the id
     is story-local so the story never reads or writes a production panel's
     persisted size. -->
<Story
  name="Vertical"
  args={{ ...storyArgs, id: "story-resizable-vertical", resizeEdge: "top", minSize: 220, maxSize: 480, defaultSize: 280 }}
  {template}
/>
