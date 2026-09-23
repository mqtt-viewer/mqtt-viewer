<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./CollectionsSection.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockCollections,
  } from "@/stories/fixtures";
  import { dragState } from "../dnd/drag-store";

  const componentName = "CollectionsSection";
  const storyId = "Views/Connection/DataView/Sidebar/CollectionsSection";
  const props: string[] = ["scope","collectionsStore","onOpenMessage","onNewMessage"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // Reordering folders: the insertion line sits above the first folder of
  // this section. Dragging is module state, so it is driven through the drag
  // store the same way a real pointer drag drives it.
  const reorderFolders = () => {
    dragState.start({
      kind: "collection",
      id: mockCollections[0].id,
      scope: "global",
    });
    dragState.setTarget({ kind: "collections", scope: "global", index: 0 });
  };

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/Sidebar/CollectionsSection",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    beforeEach: () => dragState.clear(),
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={storyArgs} {template} />
<Story
  name="ReorderingFolders"
  args={storyArgs}
  {template}
  play={reorderFolders}
/>
