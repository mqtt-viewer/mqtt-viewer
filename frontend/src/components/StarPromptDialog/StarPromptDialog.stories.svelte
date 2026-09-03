<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component, { starPromptOpen } from "./StarPromptDialog.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "StarPromptDialog";
  const storyId = "Components/StarPromptDialog";
  const props: string[] = [];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Components/StarPromptDialog",
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
  args={storyArgs}
  {template}
  play={async () => {
    // The store is module-level and shared with the Open story, so reset it
    // in case that story ran first in an interactive session.
    starPromptOpen.set(false);
  }}
/>

<Story
  name="Open"
  args={storyArgs}
  {template}
  beforeEach={() => {
    starPromptOpen.set(true);
    // The store is module-level, so the cleanup (run when switching stories)
    // puts it back so stories rendered after this one do not inherit an open
    // dialog.
    return () => {
      starPromptOpen.set(false);
    };
  }}
/>
