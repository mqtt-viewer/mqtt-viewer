<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./CollectionFolder.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockCollections,
  } from "@/stories/fixtures";
  import { dragState } from "../dnd/drag-store";

  const componentName = "CollectionFolder";
  const storyId = "Views/Connection/DataView/Sidebar/CollectionFolder";
  const props: string[] = ["collection","collectionsStore","scope","onOpenMessage","onNewMessage"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const collectionId = mockCollections[0].id;
  const dragged = {
    kind: "message",
    id: mockCollections[1].messages[0].id,
    collectionId: mockCollections[1].id,
  } as const;

  // "Drop it in here, at the end": the folder row lights up.
  const dropIntoFolder = () => {
    dragState.start(dragged);
    dragState.setTarget({ kind: "folder", collectionId });
  };

  // A precise gap: the insertion line sits between the two messages.
  const dropBetweenMessages = () => {
    dragState.start(dragged);
    dragState.setTarget({ kind: "messages", collectionId, index: 1 });
  };

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/Sidebar/CollectionFolder",
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
<Story name="DropIntoFolder" args={storyArgs} {template} play={dropIntoFolder} />
<Story
  name="DropBetweenMessages"
  args={storyArgs}
  {template}
  play={dropBetweenMessages}
/>
