<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  export let topic: string;

  let segments: string[] = [];
  let highlightedIndex: number = -1;
  let containerRef: HTMLElement;
  let highlights: {
    left: string;
    top: string;
    width: string;
    height: string;
  }[] = [];

  $: {
    segments = topic.split("/");
  }

  function handleMouseEnter(index: number) {
    highlightedIndex = index;
    updateHighlightDimensions();
  }

  function handleMouseLeave() {
    highlightedIndex = -1;
    highlights = [];
  }

  function isHighlighted(index: number): boolean {
    return index <= highlightedIndex;
  }

  function updateHighlightDimensions() {
    if (highlightedIndex === -1 || !containerRef) return;

    const items = containerRef.querySelectorAll("li");
    if (!items.length) return;

    const containerRect = containerRef.getBoundingClientRect();
    highlights = [];

    let currentLineTop: number | null = null;
    let currentLineItems: Element[] = [];

    // Process each item up to and including the highlighted index
    for (let i = 0; i <= highlightedIndex; i++) {
      const item = items[i];
      const itemRects = Array.from(item.getClientRects());

      for (const rect of itemRects) {
        if (currentLineTop === null) {
          currentLineTop = rect.top;
        }

        // If this rectangle is on a new line
        if (Math.abs(rect.top - currentLineTop) > 5) {
          if (currentLineItems.length > 0) {
            addHighlightForLine(currentLineItems, containerRect);
          }
          currentLineItems = [];
          currentLineTop = rect.top;
        }

        currentLineItems.push(item);
      }
    }

    // Add highlight for the last line
    if (currentLineItems.length > 0) {
      addHighlightForLine(currentLineItems, containerRect);
    }

    highlights = highlights;
  }

  function addHighlightForLine(items: Element[], containerRect: DOMRect) {
    const firstItem = items[0];
    const lastItem = items[items.length - 1];

    const firstRects = Array.from(firstItem.getClientRects());
    const lastRects = Array.from(lastItem.getClientRects());

    if (firstRects.length === 0 || lastRects.length === 0) return;

    const lineTop = firstRects[0].top;
    const relevantFirstRect =
      firstRects.find((rect) => Math.abs(rect.top - lineTop) < 5) ||
      firstRects[0];
    const relevantLastRect =
      lastRects.find((rect) => Math.abs(rect.top - lineTop) < 5) ||
      lastRects[lastRects.length - 1];

    const highlight = {
      left: `${relevantFirstRect.left - containerRect.left - 8}px`,
      top: `${relevantFirstRect.top - containerRect.top - 4}px`,
      width: `${relevantLastRect.right - relevantFirstRect.left + 16}px`,
      height: `${relevantFirstRect.height + 6}px`,
    };

    highlights.push(highlight);
  }

  let clicked = false;
  let clickTimeout: NodeJS.Timeout | null = null;

  $: handleClick = async (index: number) => {
    clicked = false;
    const highlightedSegments = topic.split("/").slice(0, index + 1);
    console.log("Highlighted segments:", highlightedSegments);
    const topicToCopy = highlightedSegments.join("/");
    navigator.clipboard.writeText(topicToCopy);
    await tick();
    clicked = true;
    if (!!clickTimeout) {
      clearTimeout(clickTimeout);
    }
    clickTimeout = setTimeout(() => {
      clicked = false;
      clickTimeout = null;
    }, 2000);
  };

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => {
      if (highlightedIndex >= 0) {
        updateHighlightDimensions();
      }
    });

    resizeObserver.observe(containerRef);

    return () => {
      resizeObserver.disconnect();
    };
  });

  onDestroy(() => {
    clicked = false;
    if (!!clickTimeout) {
      clearTimeout(clickTimeout);
    }
  });
</script>

<Tooltip
  text={clicked ? "Copied!" : "Copy topic"}
  openDelay={clicked ? 0 : 500}
  forceOpen={clicked}
  placement="top"
>
  <div class="px-2 relative" bind:this={containerRef}>
    {#each highlights as highlight}
      <div
        class="absolute bg-hovered rounded-md transition-all duration-200"
        style="
      left: {highlight.left};
      top: {highlight.top};
      width: {highlight.width};
      height: {highlight.height};
    "
      />
    {/each}
    <ol class="flex flex-wrap items-center relative">
      {#each segments as segment, index}
        <li class="flex items-center flex-wrap">
          {#if index > 0}
            <div
              class="px-2 cursor-pointer"
              on:mouseenter={() => handleMouseEnter(index)}
              on:mouseleave={handleMouseLeave}
              on:click={() => handleClick(index)}
            >
              <span class="text-gray-400 relative z-10">/</span>
            </div>
          {/if}
          <div
            class="cursor-pointer break-all"
            on:mouseenter={() => handleMouseEnter(index)}
            on:mouseleave={handleMouseLeave}
            on:click={() => handleClick(index)}
          >
            <span
              class="transition-colors duration-200 relative z-10"
              class:text-blue-600={isHighlighted(index)}
            >
              {segment}
            </span>
          </div>
        </li>
      {/each}
    </ol>
  </div>
</Tooltip>
