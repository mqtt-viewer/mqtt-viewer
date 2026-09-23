<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SavedMessageRow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockCollectionMessage,
  } from "@/stories/fixtures";
  import { dragState } from "../dnd/drag-store";

  const componentName = "SavedMessageRow";
  const storyId = "Views/Connection/DataView/Sidebar/SavedMessageRow";
  const props: string[] = ["message","collectionsStore","onOpenMessage"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // Dragging is module state, not a prop, so the state is driven through the
  // drag store the same way a real pointer drag drives it.
  const startDragging = () =>
    dragState.start({
      kind: "message",
      id: mockCollectionMessage.id,
      collectionId: mockCollectionMessage.collectionId,
    });

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/Sidebar/SavedMessageRow",
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
<Story name="Dragging" args={storyArgs} {template} play={startDragging} />
