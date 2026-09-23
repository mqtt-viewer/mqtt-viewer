<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./PublishView.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    createMockPublishStore,
    mockCollectionMessage,
    mockCollections,
  } from "@/stories/fixtures";

  const componentName = "PublishView";
  const storyId = "Views/Connection/DataView/Sidebar/PublishView";
  const props: string[] = ["connection","isPublishDisabled","getTopicMatchesSubscription","publishStore","publishHistoryStore","collectionsStore","onBack"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // A draft retargeted to a folder: chip in the header, Save beside Publish.
  const pendingArgs: Record<string, unknown> = {
    ...storyArgs,
    publishStore: createMockPublishStore({
      pendingCollectionId: mockCollections[1].id,
    }),
  };
  // A saved message's scratch copy: name in the header, its collection in
  // the top-right chip, Save disabled until the copy drifts from its
  // baseline.
  const savedArgs: Record<string, unknown> = {
    ...storyArgs,
    publishStore: createMockPublishStore({
      topic: mockCollectionMessage.topic,
      payload: mockCollectionMessage.payload,
      sourceMessageId: mockCollectionMessage.id,
      sourceMessageName: mockCollectionMessage.name,
      sourceCollectionId: mockCollectionMessage.collectionId,
      name: mockCollectionMessage.name,
    }),
  };

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/Sidebar/PublishView",
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
<Story name="PendingCollection" args={pendingArgs} {template} />
<Story name="SavedMessage" args={savedArgs} {template} />
