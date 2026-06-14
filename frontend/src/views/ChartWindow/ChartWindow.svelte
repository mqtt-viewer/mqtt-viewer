<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import connections from "@/stores/connections";
  import IconContext from "@/components/Icon/IconContext.svelte";
  import Toast from "@/components/Toast/Toast.svelte";
  import {
    createSelectedTopicStore,
    type SelectedTopicStore,
  } from "@/views/Connection/DataView/stores/selected-topic-store";
  import {
    createChartSeriesStore,
    labelForPath,
    CHART_PALETTE,
    type ChartSeries,
  } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-series-store";
  import ChartView from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/ChartView.svelte";

  // State comes from the window URL the backend opened:
  // /?view=chart&conn=<id>&topic=<enc>&fields=<json>
  const params = new URLSearchParams(window.location.search);
  const connectionId = parseInt(params.get("conn") ?? "0", 10);
  const topic = params.get("topic") ?? "";
  let initialFields: string[] = [];
  try {
    initialFields = JSON.parse(params.get("fields") ?? "[]");
  } catch {
    initialFields = [];
  }

  const initialSeries: ChartSeries[] = initialFields.map((path, i) => ({
    path,
    label: labelForPath(path),
    color: CHART_PALETTE[i % CHART_PALETTE.length],
    visible: true,
  }));
  const chartSeriesStore = createChartSeriesStore(initialSeries);

  let selectedTopicStore: SelectedTopicStore | null = null;
  let error = "";

  onMount(async () => {
    await connections.init();
    const connection = get(connections).connections[connectionId];
    if (!connection) {
      error = "Connection not found";
      return;
    }
    selectedTopicStore = createSelectedTopicStore(
      connectionId,
      connection.eventSet
    );
    // Loads historical and begins live-appending from the shared event stream.
    await selectedTopicStore.selectTopic(topic);
  });

  onDestroy(() => {
    // Drop the app-global event listeners when the window closes so we don't
    // leak a listener (and a forever-growing history) on the shared backend.
    selectedTopicStore?.destroy();
  });
</script>

<IconContext>
  <main
    class="h-screen w-screen bg-elevation-0 text-white-text flex flex-col p-4"
    style="--wails-draggable:drag"
  >
    <div class="text-lg text-emphasis mb-2 truncate" style="--wails-draggable:false">
      {topic || "Chart"}
    </div>
    {#if error}
      <div class="text-secondary-text">{error}</div>
    {:else if selectedTopicStore}
      <div class="grow min-h-0" style="--wails-draggable:false">
        <ChartView {selectedTopicStore} {chartSeriesStore} {topic} />
      </div>
    {:else}
      <div class="text-secondary-text">Loading…</div>
    {/if}
    <Toast />
  </main>
</IconContext>
