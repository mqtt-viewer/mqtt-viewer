<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ProtoBindingRulesForm.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";

  const componentName = "ProtoBindingRulesForm";
  const storyId = "Components/ProtoBindingRulesForm";
  const props: string[] = [
    "rules",
    "descriptorNames",
    "status",
    "disabled",
    "connected",
    "onAdd",
    "onUpdate",
    "onDelete",
    "onMove",
    "onTestTopic",
  ];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const noop = (...args: unknown[]) => {};
  const noStatus = {
    loadError: "",
    dirMissing: true,
    folderNotFound: false,
  };
  const okStatus = {
    loadError: "",
    dirMissing: false,
    folderNotFound: false,
  };
  const errorStatus = {
    loadError: "line 12: unexpected token '}'",
    dirMissing: false,
    folderNotFound: false,
  };

  const mockDescriptorNames = [
    "acme.Envelope",
    "acme.Envelope.Inner",
    "org.eclipse.tahu.protobuf.Payload",
  ];

  const mockRules = [
    {
      id: 1,
      topicFilter: "sensors/+/telemetry",
      messageType: "acme.Envelope",
    },
    { id: 2, topicFilter: "sensors/#", messageType: "acme.Envelope.Inner" },
  ];

  const staleRules = [
    { id: 1, topicFilter: "sensors/+/telemetry", messageType: "acme.Retired" },
  ];

  const mockTestResult = {
    filter: "sensors/+/telemetry",
    messageType: "acme.Envelope",
    source: "rule" as const,
  };

  const baseArgs = {
    ...storyArgs,
    descriptorNames: mockDescriptorNames,
    onAdd: noop,
    onUpdate: noop,
    onDelete: noop,
    onMove: noop,
    onTestTopic: async () => mockTestResult,
  };

  const { Story } = defineMeta({
    title: "Components/ProtoBindingRulesForm",
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

<Story
  name="EmptyNoDir"
  args={{ ...baseArgs, rules: [], descriptorNames: [], status: noStatus }}
  {template}
/>
<Story
  name="RulesPopulated"
  args={{ ...baseArgs, rules: mockRules, status: okStatus }}
  {template}
/>
<Story
  name="CompileError"
  args={{ ...baseArgs, rules: mockRules, descriptorNames: [], status: errorStatus }}
  {template}
/>
<Story
  name="StaleType"
  args={{ ...baseArgs, rules: staleRules, status: okStatus }}
  {template}
/>
<Story
  name="ConnectedLive"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, connected: true }}
  {template}
/>
<Story
  name="Disabled"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, disabled: true }}
  {template}
/>
