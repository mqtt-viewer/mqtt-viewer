<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./WhatsNewContent.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { CHANGELOG } from "@/changelog";

  const componentName = "WhatsNewContent";
  const storyId = "Components/WhatsNewDialog/WhatsNewContent";
  const props: string[] = ["entry"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Components/WhatsNewDialog/WhatsNewContent",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story
  name="Default"
  args={{ ...storyArgs, entry: CHANGELOG[0] }}
  {template}
/>