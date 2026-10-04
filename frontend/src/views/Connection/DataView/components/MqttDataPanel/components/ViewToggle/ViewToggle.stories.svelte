<script module lang="ts">
  import { expect, fn, userEvent, within } from "storybook/test";
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

<Story
  name="Default"
  args={storyArgs}
  {template}
  play={async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("button", { name: "Broker status" })).toBeNull();
  }}
/>

<Story
  name="Browser broker status"
  args={{ ...storyArgs, view: "status", showBrokerStatus: true, showSparkplug: true, onChange: fn() }}
  {template}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole("button", { name: "Broker status" });
    expect(status).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "List" }));
    expect(args.onChange).toHaveBeenCalledWith("list");
    await userEvent.click(status);
    expect(args.onChange).toHaveBeenCalledWith("status");
  }}
/>
