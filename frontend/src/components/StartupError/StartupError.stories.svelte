<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./StartupError.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "StartupError";
  const storyId = "Components/StartupError";
  const props: string[] = ["error"];
  const sampleError = new Error(
    "GetEnvInfo failed: Wails runtime is not available"
  );
  sampleError.stack = `Error: GetEnvInfo failed: Wails runtime is not available
    at init (env.ts:62:29)
    at init (initialization.ts:24:14)`;
  const storyArgs = {
    ...getStoryArgs(storyId, componentName, props),
    error: sampleError,
  };

  const { Story } = defineMeta({
    title: "Components/StartupError",
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
  name="NonErrorValue"
  args={{ ...storyArgs, error: "database is locked" }}
  {template}
/>
