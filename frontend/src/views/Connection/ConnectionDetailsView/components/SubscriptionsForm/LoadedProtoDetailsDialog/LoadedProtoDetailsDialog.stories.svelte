<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./LoadedProtoDetailsDialog.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "LoadedProtoDetailsDialog";
  const storyId = "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog";
  const props: string[] = ["open","loadedRootDir","loadedProtoFilesWithDescriptorsMap","selectedDescriptor","selectedDescriptorIsMissing","onDescriptorSelect"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/ConnectionDetailsView/SubscriptionsForm/LoadedProtoDetailsDialog",
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
