<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ViewToggle.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "ViewToggle";
  const storyId = "Components/Connection/DataView/MqttDataPanel/ViewToggle";
  const props: string[] = [];
  const storyArgs = {
    ...getStoryArgs(storyId, componentName, props),
    view: "list" as const,
    onChange: () => {},
  };

  const { Story } = defineMeta({
    title: "Components/Connection/DataView/MqttDataPanel/ViewToggle",
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
