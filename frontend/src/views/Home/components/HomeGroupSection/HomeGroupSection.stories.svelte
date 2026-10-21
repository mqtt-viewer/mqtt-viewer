<script module lang="ts">
  import { expect, fn, userEvent, within } from "storybook/test";
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./HomeGroupSection.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockConnection,
    mockConnectionDetails,
    mockDisconnectedConnection,
  } from "@/stories/fixtures";

  const componentName = "HomeGroupSection";
  const storyId = "Views/Home/HomeGroupSection";
  const props: string[] = [];

  const group = {
    id: 7,
    name: "Factory floor",
    collapsed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const third: any = {
    ...mockDisconnectedConnection,
    connectionDetails: {
      ...mockDisconnectedConnection.connectionDetails,
      id: 3,
      name: "Plant gateway",
      customIconSeed: "storybook-plant-gateway",
    },
    connectionString: "mqtt://192.168.1.20:1883",
  };
  const cards = [mockConnection, mockDisconnectedConnection, third] as any[];

  const storyArgs = {
    ...getStoryArgs(storyId, componentName, props),
    onToggle: fn(),
    onRename: fn(),
    onRenameEnd: fn(),
    onDelete: fn(),
    onCardDragStart: fn(),
    onCardHover: fn(),
    onCardDrop: fn(),
  };

  const { Story } = defineMeta({
    title: "Views/Home/HomeGroupSection",
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
  name="Open"
  args={{
    ...storyArgs,
    section: { group, connections: cards, total: 3, open: true },
  }}
  {template}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Factory floor")).toBeTruthy();
    expect(canvas.getByText("3")).toBeTruthy();
    expect(canvas.getByText("Plant gateway")).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: /Factory floor/ }));
    expect(args.onToggle).toHaveBeenCalled();
  }}
/>

<Story
  name="Collapsed"
  args={{
    ...storyArgs,
    section: {
      group: { ...group, collapsed: true },
      connections: cards,
      total: 3,
      open: false,
    },
  }}
  {template}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Factory floor")).toBeTruthy();
    expect(canvas.queryByText("Plant gateway")).toBeNull();
  }}
/>

<Story
  name="UngroupedSearching"
  args={{
    ...storyArgs,
    isSearching: true,
    search: "192.168",
    section: { group: null, connections: [third], total: 3, open: true },
  }}
  {template}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Ungrouped")).toBeTruthy();
    expect(canvas.getByText("1 of 3")).toBeTruthy();
    expect(canvas.getByText("192.168").tagName).toBe("MARK");
  }}
/>

<Story
  name="Renaming"
  args={{
    ...storyArgs,
    isRenaming: true,
    section: { group, connections: [], total: 0, open: true },
  }}
  {template}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Factory floor");
    await userEvent.clear(input);
    await userEvent.type(input, "Cold store{Enter}");
    expect(args.onRename).toHaveBeenCalledWith("Cold store");
    expect(args.onRenameEnd).toHaveBeenCalledTimes(1);
  }}
/>

<Story
  name="RenameUnchanged"
  args={{
    ...storyArgs,
    isRenaming: true,
    section: { group, connections: [], total: 0, open: true },
  }}
  {template}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "{Enter}");
    expect(args.onRename).not.toHaveBeenCalled();
    expect(args.onRenameEnd).toHaveBeenCalledTimes(1);
    expect(canvas.queryByRole("textbox")).toBeNull();
  }}
/>

<Story
  name="RenameEscape"
  args={{
    ...storyArgs,
    isRenaming: true,
    section: { group, connections: [], total: 0, open: true },
  }}
  {template}
  play={async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "x{Escape}");
    expect(args.onRename).not.toHaveBeenCalled();
    expect(args.onRenameEnd).toHaveBeenCalledTimes(1);
    expect(canvas.queryByRole("textbox")).toBeNull();
  }}
/>

<Story
  name="DropTarget"
  args={{
    ...storyArgs,
    isDropTarget: true,
    section: { group, connections: [], total: 0, open: true },
  }}
  {template}
/>
