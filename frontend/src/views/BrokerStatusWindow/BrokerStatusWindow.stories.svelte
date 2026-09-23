<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./BrokerStatusWindow.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "BrokerStatusWindow";
  const storyId = "Views/BrokerStatusWindow";
  const props: string[] = [];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // The shell reads its connection id from the window URL (the backend opens
  // it as /?view=status&conn=<id>). Without this the story only ever renders
  // the "Connection not found" error path, so the header, pill and banner are
  // never exercised. Inject conn=1 (the mock connection) before mount.
  if (
    typeof window !== "undefined" &&
    !window.location.search.includes("conn=")
  ) {
    const sep = window.location.search === "" ? "?" : "&";
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${sep}conn=1`
    );
  }

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow",
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
