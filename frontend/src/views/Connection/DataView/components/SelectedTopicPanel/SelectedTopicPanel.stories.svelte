<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./SelectedTopicPanel.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    createMockSelectedTopicStore,
    getStoryArgTypes,
    getStoryArgs,
  } from "@/stories/fixtures";
  import { get } from "svelte/store";
  import { expect, waitFor } from "storybook/test";

  const componentName = "SelectedTopicPanel";
  const storyId = "Views/Connection/DataView/SelectedTopicPanel";
  const props: string[] = ["connectionId","selectedTopicStore","firstConnectedAtMs","mqttVersion","exportTopicMessages","copyTopicPath","onClearRetained","onClearRetainedBelow","openChartWindow","dockMode","onSetDockMode","showCloseButton","headerDraggable","headerLeftInset","viewState","isPinned","onTogglePin"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // Stores of their own so the play functions can push live messages into
  // the same instances the panels render.
  const liveStore = createMockSelectedTopicStore();
  liveStore.setComparing(false);
  const liveCompareStore = createMockSelectedTopicStore();
  liveCompareStore.setComparing(true);

  // Mirrors the store's live listener: append the entries undecoded (payload
  // null, raw bytes kept on payloadB64), then hand the delta to the
  // timeline, which auto-selects the newest on its next flush. Ids are
  // unique per call, so a re-run in Storybook appends fresh undecoded
  // entries instead of landing on a copy an earlier run already decoded.
  let liveSeq = 0;
  const appendLiveMessages = (store: typeof liveStore, payloads: string[]) => {
    const s = get(store);
    const entries = payloads.map((payload) => ({
      id: `message-live-${++liveSeq}`,
      topic: "factory/line/temperature",
      payload: null,
      payloadB64: btoa(payload),
      payloadState: "unfetched",
      qos: 0,
      retain: false,
      timeMs: Date.now() + liveSeq,
      middlewareProperties: { IsDecodedProto: true },
    })) as any[];
    store.set({
      ...s,
      history: [...s.history, ...entries],
      totalCount: s.totalCount + entries.length,
    });
    s.onHistoryDelta?.({ kind: "append", messages: entries });
  };

  // Compare mode where the previous message aged out (payload gone for
  // good). Nothing is left to fetch, so the panel must settle instead of
  // re-requesting it in a loop.
  const agedOutPreviousStore = createMockSelectedTopicStore();
  agedOutPreviousStore.set({
    ...get(agedOutPreviousStore),
    history: [
      {
        id: "gone-1",
        topic: "factory/line/temperature",
        payload: null,
        payloadB64: null,
        payloadState: "aged-out",
        qos: 0,
        retain: false,
        timeMs: Date.now() - 60000,
        middlewareProperties: { IsDecodedProto: false },
      },
      {
        id: "live-x",
        topic: "factory/line/temperature",
        payload: '{"selectedAfterAgedOut":true}',
        payloadB64: btoa('{"selectedAfterAgedOut":true}'),
        payloadState: "loaded",
        qos: 0,
        retain: false,
        timeMs: Date.now(),
        middlewareProperties: { IsDecodedProto: false },
      },
    ] as any,
    totalCount: 2,
    options: {
      ...get(agedOutPreviousStore).options,
      autoSelect: true,
      compare: true,
    },
  });

  // Compare starts off: the selected message is loaded, the previous one is
  // a live message still undecoded. Turning compare on must decode it.
  const livePreviousStore = createMockSelectedTopicStore();
  const livePreviousHistory = () =>
    [
      {
        id: "prev-live",
        topic: "factory/line/temperature",
        payload: null,
        payloadB64: btoa('{"previousUndecoded":true}'),
        payloadState: "unfetched",
        qos: 0,
        retain: false,
        timeMs: Date.now() - 1000,
        middlewareProperties: { IsDecodedProto: false },
      },
      {
        id: "selected-loaded",
        topic: "factory/line/temperature",
        payload: '{"selectedLoaded":true}',
        payloadB64: btoa('{"selectedLoaded":true}'),
        payloadState: "loaded",
        qos: 0,
        retain: false,
        timeMs: Date.now(),
        middlewareProperties: { IsDecodedProto: false },
      },
    ] as any;
  const resetLivePreviousStore = () =>
    livePreviousStore.set({
      ...get(livePreviousStore),
      history: livePreviousHistory(),
      totalCount: 2,
      options: {
        ...get(livePreviousStore).options,
        autoSelect: true,
        compare: false,
      },
    });
  resetLivePreviousStore();

  const { Story } = defineMeta({
    title: "Views/Connection/DataView/SelectedTopicPanel",
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

<!-- The selected topic is pinned, so the header's pin button is filled and its
     menu item reads "Unpin topic". -->
<Story name="Pinned" args={{ ...storyArgs, isPinned: true }} {template} />

<!-- Dock side "right" (default, narrow width): matches DataView's ResizableContainer
     resizeEdge="left" placement, the current/unchanged docked-right layout. -->
<Story
  name="DockedRight"
  args={{ ...storyArgs, dockMode: "right" }}
  {template}
/>

<!-- Dock side "bottom" (wide, short): matches DataView's ResizableContainer
     resizeEdge="top" placement, so MessageTimeline/tabs/ChartView can be
     reviewed at wide-and-short proportions. -->
<Story
  name="DockedBottom"
  args={{ ...storyArgs, dockMode: "bottom" }}
  {template}
/>

<!-- Window mode header: the panel header is the pop-out window's drag region,
     inset past the macOS traffic lights. Verifies the header still lays out
     with the spacer in place. -->
<Story
  name="WindowHeader"
  args={{
    ...storyArgs,
    dockMode: "window",
    showCloseButton: false,
    headerDraggable: true,
    headerLeftInset: 62,
  }}
  {template}
/>

<!-- Regression for issue #177: a live message auto-selected on arrival must
     render its payload, not sit on "Loading message...". -->
<Story
  name="LiveMessageAutoSelected"
  args={{ ...storyArgs, selectedTopicStore: liveStore }}
  {template}
  play={async ({ canvasElement }) => {
    appendLiveMessages(liveStore, ['{"arrivedLive177":true}']);
    await waitFor(
      () => {
        expect(canvasElement.textContent).toContain("arrivedLive177");
        expect(canvasElement.textContent).not.toContain("Loading message...");
      },
      { timeout: 3000 }
    );
  }}
/>

<!-- Issue #177 in compare mode: two live messages in one batch, so both the
     selected message and the previous one start undecoded. Both sides of
     the diff must render. -->
<Story
  name="LiveMessagesCompared"
  args={{ ...storyArgs, selectedTopicStore: liveCompareStore }}
  {template}
  play={async ({ canvasElement }) => {
    appendLiveMessages(liveCompareStore, [
      '{"previousLive177":true}',
      '{"selectedLive177":true}',
    ]);
    await waitFor(
      () => {
        expect(canvasElement.textContent).toContain("previousLive177");
        expect(canvasElement.textContent).toContain("selectedLive177");
        expect(canvasElement.textContent).not.toContain("Loading message...");
      },
      { timeout: 3000 }
    );
  }}
/>

<!-- Compare mode with an aged-out previous message. Its payload is gone, so
     the panel shows why and the selected payload, and the store must stop
     changing (it used to loop forever and hang the page). -->
<Story
  name="CompareAgedOutPrevious"
  args={{ ...storyArgs, selectedTopicStore: agedOutPreviousStore }}
  {template}
  play={async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(canvasElement.textContent).toContain("selectedAfterAgedOut");
        expect(canvasElement.textContent).toContain("No longer in session memory");
      },
      { timeout: 3000 }
    );
    const historyBefore = get(agedOutPreviousStore).history;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(get(agedOutPreviousStore).history).toBe(historyBefore);
    expect(get(agedOutPreviousStore).history[0].payloadState).toBe("aged-out");
  }}
/>

<!-- Compare toggled on after selection: the previous message is a live one
     still undecoded, so the deferred ensurePayload for it must decode it and
     both sides of the diff must render. -->
<Story
  name="CompareToggledOnLivePrevious"
  args={{ ...storyArgs, selectedTopicStore: livePreviousStore }}
  {template}
  play={async ({ canvasElement }) => {
    // Re-seed so a re-run starts from the undecoded previous message again.
    resetLivePreviousStore();
    await waitFor(
      () => expect(canvasElement.textContent).toContain("selectedLoaded"),
      { timeout: 3000 }
    );
    expect(canvasElement.textContent).not.toContain("previousUndecoded");
    livePreviousStore.setComparing(true);
    await waitFor(
      () => {
        expect(canvasElement.textContent).toContain("previousUndecoded");
        expect(canvasElement.textContent).toContain("selectedLoaded");
        expect(canvasElement.textContent).not.toContain("Loading message...");
      },
      { timeout: 3000 }
    );
    expect(get(livePreviousStore).history[0].payloadState).toBe("loaded");
  }}
/>
