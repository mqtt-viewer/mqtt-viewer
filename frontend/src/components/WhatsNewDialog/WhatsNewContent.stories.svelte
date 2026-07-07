<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./WhatsNewContent.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { CHANGELOG, releasedEntries } from "@/changelog";

  const componentName = "WhatsNewContent";
  const storyId = "Components/WhatsNewDialog/WhatsNewContent";
  const props: string[] = ["entries", "initialVersion"];
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

<!-- Released history only: how the dialog looks on a shipped build. -->
<Story
  name="Default"
  args={{
    ...storyArgs,
    entries: releasedEntries(),
    initialVersion: "1.0.0",
  }}
  {template}
/>

<!-- Dev build: the unreleased staging entry leads as the newest tab. -->
<Story
  name="With unreleased tab"
  args={{ ...storyArgs, entries: CHANGELOG, initialVersion: null }}
  {template}
/>

<!-- A single release: no tab strip. -->
<Story
  name="Single release"
  args={{ ...storyArgs, entries: releasedEntries().slice(0, 1) }}
  {template}
/>
