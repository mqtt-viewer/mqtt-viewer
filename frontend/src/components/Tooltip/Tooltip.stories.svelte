<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./Tooltip.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "Tooltip";
  const storyId = "Primitives/Tooltip";
  const props: string[] = ["placement","text","openDelay","forceOpen","closeOnPointerDown","focusable"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Primitives/Tooltip",
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

{#snippet wrappingButtonTemplate(args: any)}
  <div class="min-h-[180px] size-full bg-elevation-0 p-5 text-white-text">
    <Component {...args} text="Focusable trigger" focusable>
      <button class="rounded bg-button px-3 py-2">Focusable button</button>
    </Component>
  </div>
{/snippet}

<Story name="WrappingButton" args={storyArgs} template={wrappingButtonTemplate} />

{#snippet wrappingTextTemplate(args: any)}
  <div class="min-h-[180px] size-full bg-elevation-0 p-5 text-white-text">
    <Component {...args} text="Plain text trigger">
      <span>Plain text trigger</span>
    </Component>
  </div>
{/snippet}

<Story name="WrappingText" args={storyArgs} template={wrappingTextTemplate} />
