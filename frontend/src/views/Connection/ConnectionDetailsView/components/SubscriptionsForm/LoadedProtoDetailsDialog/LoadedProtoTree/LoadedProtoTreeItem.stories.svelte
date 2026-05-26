<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./LoadedProtoTreeItem.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "LoadedProtoTreeItem";
  const storyId = "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog/LoadedProtoTree/LoadedProtoTreeItem";
  const props: string[] = ["allowPress","isExpanded","isSelected","name","iconType"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog/LoadedProtoTree/LoadedProtoTreeItem",
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
