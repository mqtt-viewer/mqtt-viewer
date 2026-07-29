<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ProtoTypePicker.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "ProtoTypePicker";
  const storyId = "Components/ProtoBindingRulesForm/ProtoTypePicker";
  const props: string[] = ["value", "descriptorNames", "disabled", "onPick"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const noop = (...args: unknown[]) => {};

  const mockDescriptorNames = [
    "acme.Envelope",
    "acme.Envelope.Inner",
    "org.eclipse.tahu.protobuf.Payload",
  ];

  const baseArgs = {
    ...storyArgs,
    descriptorNames: mockDescriptorNames,
    value: "",
    disabled: false,
    onPick: noop,
  };

  const { Story } = defineMeta({
    title: "Components/ProtoBindingRulesForm/ProtoTypePicker",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } }, // TODO(figma-url)
  });
</script>

{#snippet template(args: any)}
  <div class="w-[502px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story name="TypesLoadedNothingChosen" args={{ ...baseArgs }} {template} />
<Story
  name="TypeChosen"
  args={{ ...baseArgs, value: "acme.Envelope.Inner" }}
  {template}
/>
<Story
  name="NoTypesLoaded"
  args={{ ...baseArgs, descriptorNames: [] }}
  {template}
/>
<Story name="Disabled" args={{ ...baseArgs, value: "acme.Envelope", disabled: true }} {template} />
