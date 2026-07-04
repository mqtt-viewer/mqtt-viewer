<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./MessageTimeline.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    createBusyMockSelectedTopicStore,
  } from "@/stories/fixtures";

  const componentName = "MessageTimeline";
  const storyId = "Views/Connection/DataView/SelectedTopicPanel/MessageTimeline";
  const props: string[] = ["connectionId","selectedTopicStore","firstConnectedAtMs","onMessageSelect","isAutoSelectingMostRecent"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/SelectedTopicPanel/MessageTimeline",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });

  // Perf repro/verification rig: 5,000-message history (matching
  // HISTORY_WINDOW_SIZE) plus ~40 tiny live appends every 300ms, mimicking a
  // busy broker topic. See fixtures.ts createBusyMockSelectedTopicStore.
  const busy = createBusyMockSelectedTopicStore();
  const busyStoryArgs = {
    ...storyArgs,
    selectedTopicStore: busy.store,
    firstConnectedAtMs: Date.now() - 60 * 60 * 1000,
  };
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

{#snippet busyTemplate(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={storyArgs} {template} />

<!-- Interactive perf rig only: the endless live-append interval never lets the
  page settle, so the automated story smoke test (vitest) would time out
  waiting for idle. The test runner includes stories by the autodocs tag
  (vite.config.ts storybookTest tags), so removing it here excludes just this
  story; open it in the Storybook UI to profile timeline behaviour under
  sustained load. -->
<Story
  name="BusyTopic"
  args={busyStoryArgs}
  template={busyTemplate}
  tags={["!autodocs"]}
  play={async () => {
    busy.startLiveAppends();
  }}
/>
