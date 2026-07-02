<script lang="ts">
  import type { PayloadNode } from "./payload-fields";
  import Icon from "@/components/Icon/Icon.svelte";

  export let node: PayloadNode;
  export let depth = 0;
  // path -> assigned series colour (present == selected)
  export let selected: Map<string, string>;
  export let onToggle: (path: string) => void;

  $: indent = depth * 14;
  $: isContainer = node.type === "object" || node.type === "array";
  // Numbers and quoted numerics (e.g. "24.6") can both be charted.
  $: isChartable = node.chartable === true;
  $: color = selected.get(node.path);
  $: open = node.type === "array" ? "[" : "{";
  $: close = node.type === "array" ? "]" : "}";
  $: valueText =
    node.type === "string"
      ? `"${node.value}"`
      : node.type === "null"
        ? "null"
        : String(node.value);
  $: valueClass =
    node.type === "number"
      ? "text-emphasis"
      : node.type === "string"
        ? "text-success"
        : "text-secondary-text";
</script>

{#if isContainer}
  <div
    class="font-mono text-base text-secondary-text py-[1px]"
    style:padding-left={`${indent}px`}
  >
    {#if depth > 0}<span>{node.key}: </span>{/if}<span
      >{node.children?.length ? open : `${open}${close}`}</span
    >
  </div>
  {#each node.children ?? [] as child (child.path)}
    <svelte:self node={child} depth={depth + 1} {selected} {onToggle} />
  {/each}
  {#if node.children?.length}
    <div
      class="font-mono text-base text-secondary-text py-[1px]"
      style:padding-left={`${indent}px`}
    >
      {close}
    </div>
  {/if}
{:else}
  <div
    class={`flex items-center font-mono text-base py-[2px] pr-1 rounded ${
      isChartable ? "hover:bg-hovered cursor-pointer" : ""
    }`}
    style:padding-left={`${indent}px`}
    on:click={isChartable ? () => onToggle(node.path) : undefined}
    role={isChartable ? "button" : undefined}
    tabindex={isChartable ? 0 : undefined}
    on:keydown={isChartable
      ? (e) => (e.key === "Enter" || e.key === " ") && onToggle(node.path)
      : undefined}
  >
    {#if depth > 0}<span class="text-secondary-text">{node.key}:&nbsp;</span>{/if}
    <span class={valueClass}>{valueText}</span>
    <div class="grow"></div>
    {#if isChartable}
      <span
        class="size-4 min-w-4 rounded-[3px] border flex items-center justify-center"
        style:border-color={color ?? "var(--color-secondary-text)"}
        style:background-color={color ?? "transparent"}
        style:color="var(--color-elevation-0)"
      >
        {#if color}<Icon type="tick" size={11} />{/if}
      </span>
    {/if}
  </div>
{/if}
