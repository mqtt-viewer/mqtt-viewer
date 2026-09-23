<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./WhatsNewContent.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { CHANGELOG, releasedEntries, unreleasedEntry } from "@/changelog";

  // The staging entry groups its sections under Added / Changed / Fixed /
  // Miscellaneous. Falls back to the newest release right after a promotion,
  // when there is no staging entry.
  const groupedEntries = () => {
    const staging = unreleasedEntry();
    return staging ? [staging] : releasedEntries().slice(0, 1);
  };

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

<!-- Grouped sections: headings for Added, Changed, Fixed and Miscellaneous. -->
<Story
  name="Grouped sections"
  args={{ ...storyArgs, entries: groupedEntries() }}
  {template}
/>
