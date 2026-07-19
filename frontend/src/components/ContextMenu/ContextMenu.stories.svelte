<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ContextMenu.svelte";
  import DropdownMenuItem from "../DropdownMenu/DropdownMenuItem.svelte";
  import { getStoryArgTypes } from "@/stories/fixtures";

  const componentName = "ContextMenu";
  const props: string[] = ["portal", "onOpen"];

  const { Story } = defineMeta({
    title: "Primitives/ContextMenu",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

<script lang="ts">
  // The menu is slot-based and opens at the pointer, so it renders directly
  // rather than through StoryRender: there is no way to express trigger and
  // menu-content slots through the generic renderer.
  let lastAction = "";
</script>

{#snippet template(args: any)}
  <div class="p-4 text-white-text">
    <Component {...args}>
      <div
        slot="trigger"
        class="flex h-32 w-80 items-center justify-center rounded border border-dashed border-secondary-text text-secondary-text"
      >
        Right-click anywhere in this box
      </div>
      <svelte:fragment slot="menu-content">
        <DropdownMenuItem onClick={() => (lastAction = "Copy")}>
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (lastAction = "Rename")}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (lastAction = "Delete")}>
          Delete
        </DropdownMenuItem>
      </svelte:fragment>
    </Component>
    <div class="mt-3 text-xs text-secondary-text">
      Last action: {lastAction || "none"}
    </div>
  </div>
{/snippet}

<Story name="Default" args={{}} {template} />

{#snippet suppressed(args: any)}
  <div class="p-4 text-white-text">
    <Component
      {...args}
      onOpen={(event) =>
        (event.target as HTMLElement)?.closest("[data-menu-target]") !== null}
    >
      <div slot="trigger" class="flex w-80 flex-col gap-2">
        <div
          data-menu-target
          class="flex h-16 items-center justify-center rounded border border-dashed border-primary text-secondary-text"
        >
          Right-click here: menu opens
        </div>
        <div
          class="flex h-16 items-center justify-center rounded border border-dashed border-secondary-text text-secondary-text"
        >
          Right-click here: suppressed
        </div>
      </div>
      <svelte:fragment slot="menu-content">
        <DropdownMenuItem onClick={() => {}}>An action</DropdownMenuItem>
      </svelte:fragment>
    </Component>
  </div>
{/snippet}

<Story name="Suppressed on empty space" args={{}} template={suppressed} />
