<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component, { addToast } from "./Toast.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "Toast";
  const storyId = "Primitives/Toast";
  const props: string[] = [];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Primitives/Toast",
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

{#snippet withTextDescription()}
  <StoryRender component={Component} args={{}} {componentName} />
{/snippet}

<Story
  name="Text description"
  args={{}}
  template={withTextDescription}
  play={async () => {
    addToast({
      data: {
        title: "Collection renamed",
        description: "renamed to 'production alerts'",
        type: "success",
      },
      closeDelay: 0,
    });
  }}
/>

{#snippet withCodeDescription()}
  <StoryRender component={Component} args={{}} {componentName} />
{/snippet}

<Story
  name="Code description (topic)"
  args={{}}
  template={withCodeDescription}
  play={async () => {
    addToast({
      data: {
        title: "Cleared retained message",
        description: "rev121/a/config",
        type: "success",
        descriptionStyle: "code",
      },
      closeDelay: 0,
    });
  }}
/>
