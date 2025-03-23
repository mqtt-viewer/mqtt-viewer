<script lang="ts">
  import connections from "@/stores/connections";
  import connectionTabs from "@/stores/tabs";
  import { onDestroy, onMount, tick } from "svelte";
  import ConnectionTab from "./ConnectionTab.svelte";
  import gsap from "gsap";
  import { Draggable } from "gsap/Draggable";
  import CloseActiveConnectionDialog from "./CloseActiveConnectionDialog.svelte";
  import { writable } from "svelte/store";

  const MAX_TAB_WIDTH = 180;
  const MIN_TAB_WIDTH = 46;

  const getTabWidth = (containerWidth: number) => {
    const countTabs = $connectionTabs.tabs.length;
    const tabWidth = Math.floor(containerWidth / countTabs);
    if (tabWidth < MIN_TAB_WIDTH) {
      return MIN_TAB_WIDTH;
    }
    if (tabWidth > MAX_TAB_WIDTH) {
      return MAX_TAB_WIDTH;
    }
    return tabWidth;
  };

  export let maxContainerWidth = 0;
  $: tabWidth = getTabWidth(maxContainerWidth);
  $: tabWidth,
    (async () => {
      await tick();
      buildTabs();
    })();

  let openTabs: number[] = [];
  let countOpenTabs = 0;
  let openConnectionIds: number[] = [];

  let gsapCtx: gsap.Context;
  let sortables: any[];
  let dragContainerEl: HTMLElement;
  let isClosingActiveConnectionId = null as number | null;
  let isCloseActiveConnectionDialogOpen = writable(false);

  const onCloseClick = async (connId: number) => {
    const isConnected =
      $connections.connections[connId].connectionState === "connected";
    if (!isConnected) {
      connectionTabs.closeTab(connId);
      return;
    }
    isCloseActiveConnectionDialogOpen.set(true);
    isClosingActiveConnectionId = connId;
  };

  const onCloseDialogConfirm = () => {
    connections.disconnect(isClosingActiveConnectionId!);
    connectionTabs.closeTab(isClosingActiveConnectionId!);
    isCloseActiveConnectionDialogOpen.set(false);
    isClosingActiveConnectionId = null;
  };

  const onCloseDialogCancel = () => {
    isCloseActiveConnectionDialogOpen.set(false);
    isClosingActiveConnectionId = null;
  };

  $: $connectionTabs.tabs,
    (async () => {
      const tabs = $connectionTabs.tabs;
      if (tabs.length === countOpenTabs) {
        return;
      }
      await tick();
      tabWidth = getTabWidth(maxContainerWidth);
      buildTabs();
    })();

  const buildTabs = async () => {
    if (!!gsapCtx) {
      gsapCtx.revert({});
    }
    openTabs = $connectionTabs.tabs;
    const openConnectionsMap = new Map(
      Object.entries($connections.connections)
    );
    openConnectionIds = [];
    for (const tab of openTabs) {
      const tabString = tab.toString();
      const openConnection = openConnectionsMap.get(tabString);
      if (!openConnection) {
        continue;
      }
      openConnectionIds.push(openConnection.connectionDetails.id);
    }
    countOpenTabs = openConnectionIds.length;
    if (countOpenTabs === 0) {
      return;
    }
    await tick();
    gsapCtx = gsap.context((self) => {
      const listItems = self.selector!(".tab");
      sortables = listItems.map((item: HTMLElement, index: number) =>
        Sortable(item, index, openConnectionIds[index])
      );
    }, dragContainerEl);
  };

  onMount(async () => {
    buildTabs();
  });

  onDestroy(() => {
    gsapCtx.revert();
  });

  const changeIndex = (item: ReturnType<typeof Sortable>, to: number) => {
    console.log("original sortables", sortables);
    // Change position in array
    arrayMove(sortables, item.index, to);
    console.log("new sortables", sortables);

    // Set index for each sortable
    sortables.forEach((sortable, index) => sortable.setIndex(index));
  };

  function arrayMove(array: any[], from: number, to: number) {
    array.splice(to, 0, array.splice(from, 1)[0]);
  }

  const persistOrder = () => {
    const newOrder = sortables.map((sortable) => sortable.connectionId);
    connectionTabs.updateTabIndexes(newOrder);
  };

  function Sortable(element: HTMLElement, index: number, connectionId: number) {
    function downAction() {
      // @ts-ignore
      this.update();
    }

    function dragAction() {
      // Calculate the current index based on element's position
      let index = gsap.utils.clamp(
        0,
        countOpenTabs - 1,
        // @ts-ignore
        Math.round(this.x / (1.0 * tabWidth))
      );
      if (index !== sortable.index) {
        changeIndex(sortable, index);
      }
    }

    function upAction() {
      persistOrder();
      layout();
    }

    let dragger = new Draggable(element, {
      bounds: dragContainerEl,
      onDragStart: downAction,
      onRelease: upAction,
      onDrag: dragAction,
      cursor: "inherit",
      type: "x",
    });

    function setIndex(index: number) {
      sortable.index = index;

      // Don't layout if you're dragging
      if (!dragger.isDragging) {
        layout();
      }
    }

    let sortable = {
      dragger: dragger,
      element: element,
      index: index,
      setIndex: setIndex,
      connectionId,
    };
    gsap.set(element, { x: sortable.index * tabWidth });

    function layout() {
      gsap.to(element, { duration: 0.3, x: sortable.index * tabWidth });
    }
    return sortable;
  }
</script>

<div
  class="h-full flex relative"
  style:width={countOpenTabs * tabWidth + "px"}
  id="drag-container"
  bind:this={dragContainerEl}
>
  {#each openConnectionIds as openConnectionId}
    {@const connection = $connections.connections[openConnectionId]}
    {@const isSelected =
      $connectionTabs.selectedTab === openConnectionId &&
      !$connectionTabs.isNewTabSelected}
    <div
      class="tab tab-content absolute top-0 left-0 z-10"
      style="--wails-draggable:false"
    >
      <ConnectionTab
        width={tabWidth}
        {connection}
        {isSelected}
        onClick={() => connectionTabs.selectTab(openConnectionId)}
        onDeleteClick={() => onCloseClick(openConnectionId)}
      />
    </div>
  {/each}
  <CloseActiveConnectionDialog
    open={isCloseActiveConnectionDialogOpen}
    connection={isClosingActiveConnectionId
      ? $connections.connections[isClosingActiveConnectionId]
      : null}
    onConfirm={onCloseDialogConfirm}
    onCancel={onCloseDialogCancel}
  />
</div>
