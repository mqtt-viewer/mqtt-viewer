<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./PayloadTab.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "PayloadTab";
  const storyId = "Views/Connection/DataView/SelectedTopicPanel/PayloadTab";
  const props: string[] = ["isComparing","payload","payloadLeftForCompare","payloadB64","codec","format"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // 1x1 red PNG — exercises the image-payload preview (issue #35)
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/SelectedTopicPanel/PayloadTab",
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

<Story
  name="Image payload"
  args={{
    ...storyArgs,
    isComparing: false,
    payload: "PNG…",
    payloadB64: TINY_PNG,
    format: "none",
  }}
  {template}
/>
