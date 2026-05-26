<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./LoadedProtoTree.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "LoadedProtoTree";
  const storyId = "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog/LoadedProtoTree";
  const props: string[] = ["treeItems","level","selectedDescriptor","onDescriptorSelect"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog/LoadedProtoTree",
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
