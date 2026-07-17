<script lang="ts">
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Icon from "@/components/Icon/Icon.svelte";

  /**
   * The actions offered for a topic, shared by the list tree, the graph, and
   * the selected-topic panel so the three surfaces stay in step.
   *
   * This renders menu items only. The surrounding menu (a ContextMenu in the
   * tree and graph, a DropdownMenu in the panel) supplies the melt "menu-elements"
   * context that DropdownMenuItem reads.
   */

  /** The topic these actions apply to. */
  export let topic: string;
  /** False for an intermediate branch node, which has no value of its own. */
  export let hasPayload = false;
  /** Whether this exact topic holds a retained message, as far as we know. */
  export let isRetained = false;
  /** How many known-retained topics sit strictly below this one. */
  export let retainedBelowCount = 0;
  /** Hide the topic header when the surrounding UI already names the topic. */
  export let showHeader = true;

  export let onCopyTopic: (topic: string) => void;
  export let onCopyPayload: (topic: string) => void;
  export let onExport: (topic: string) => void;
  export let onClearRetained: (topic: string) => void;
  export let onClearRetainedBelow: (prefix: string) => void;

  // Right-click does not move selection, so the menu names its own target.
  // Without this, a right-click on one topic while another is selected gives no
  // clue which one the actions apply to. Long paths elide in the middle: the
  // leaf segment identifies the topic and matters most.
  const MAX_HEADER_CHARS = 42;
  const elideMiddle = (value: string) => {
    if (value.length <= MAX_HEADER_CHARS) return value;
    const keep = Math.floor((MAX_HEADER_CHARS - 1) / 2);
    return `${value.slice(0, keep)}…${value.slice(-keep)}`;
  };
</script>

{#if showHeader}
  <div
    class="max-w-[280px] select-none truncate px-2 pb-1 pt-0.5 text-xs text-secondary-text"
    title={topic}
  >
    {elideMiddle(topic)}
  </div>
{/if}

<DropdownMenuItem onClick={() => onCopyTopic(topic)}>
  <span class="flex items-center gap-2">
    <Icon type="copy" size={16} />
    <span>Copy topic path</span>
  </span>
</DropdownMenuItem>

{#if hasPayload}
  <DropdownMenuItem onClick={() => onCopyPayload(topic)}>
    <span class="flex items-center gap-2">
      <Icon type="copy" size={16} />
      <span>Copy payload</span>
    </span>
  </DropdownMenuItem>

  <DropdownMenuItem onClick={() => onExport(topic)}>
    <span class="flex items-center gap-2">
      <Icon type="download" size={16} />
      <span>Export message history</span>
    </span>
  </DropdownMenuItem>
{/if}

<DropdownMenuItem
  onClick={() => (isRetained ? onClearRetained(topic) : undefined)}
  class={isRetained ? "" : "cursor-default opacity-40"}
>
  <span class="flex items-center gap-2">
    <Icon type="delete" size={16} />
    <span>Clear retained message</span>
  </span>
</DropdownMenuItem>

{#if retainedBelowCount > 0}
  <DropdownMenuItem onClick={() => onClearRetainedBelow(topic)}>
    <span class="flex items-center gap-2">
      <Icon type="delete" size={16} />
      <span>
        Clear {retainedBelowCount} retained
        {retainedBelowCount === 1 ? "message" : "messages"} below
      </span>
    </span>
  </DropdownMenuItem>
{/if}
