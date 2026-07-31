<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import DropdownCloseOnClick from "@/components/DropdownMenu/DropdownCloseOnClick.svelte";
  import { twMerge } from "tailwind-merge";
  import type { SparkplugNode } from "../../stores/sparkplug-tree-store";
  import { formatAge, type SparkplugTreeRow } from "./build-sparkplug-tree";

  export let row: SparkplugTreeRow;
  /** Reference now for relative ages (from the store snapshot). */
  export let nowMs: number;
  export let onToggleExpansion: (key: string) => void;
  export let onRequestRebirth: (group: string, node: string) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;

  $: node = row.node;
  $: device = row.device;
  $: metric = row.metric;
  $: expandable = row.kind !== "metric";
  $: scopeOnline =
    row.kind === "device" ? (device?.online ?? false) : (node?.online ?? false);
  $: deathAtMs = row.kind === "device" ? device?.deathAtMs : node?.deathAtMs;
</script>

<div
  class={twMerge(
    "group relative flex whitespace-nowrap select-none",
    "overflow-hidden min-w-0 w-full",
    expandable ? "cursor-pointer" : "cursor-default"
  )}
>
  <button
    class="shrink-0"
    on:click={() => {
      if (expandable) onToggleExpansion(row.key);
    }}
  >
    <div class="w-4 relative">
      {#if expandable}
        <div class={`${row.isExpanded ? "rotate-90" : "rotate-0"}`}>
          <Button variant="text" iconType="right" iconSize={14} />
        </div>
      {/if}
    </div>
  </button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class={twMerge(
      "text-secondary-text font-thin font-mono text-base ring-inset px-1",
      "flex grow items-center min-w-0 gap-2",
      "rounded truncate overflow-hidden",
      "hover:ring-1 hover:ring-secondary-text"
    )}
    on:click={() => {
      if (expandable) onToggleExpansion(row.key);
    }}
  >
    {#if row.kind === "group" && row.group}
      <span>Group:</span>
      <span class="font-semibold text-white-text">{row.group.name}</span>
    {:else if row.kind === "node" && node}
      <span
        class={twMerge(
          "font-semibold truncate",
          node.online ? "text-white-text" : "text-secondary-text"
        )}>{node.name}</span
      >
      <span
        class={twMerge(
          "size-1.5 rounded-full shrink-0",
          node.online ? "bg-success" : "bg-error"
        )}
      ></span>
      {#if !node.online && deathAtMs !== undefined}
        <span class="text-sm">death {formatAge(deathAtMs, nowMs)} ago</span>
      {/if}
      <!-- Hover-revealed node actions (same affordance pattern as the $SYS
           row's broker-status button in MqttTopicRow). -->
      <div
        class={twMerge(
          "flex items-center gap-1",
          "opacity-0 pointer-events-none",
          "group-hover:opacity-100 group-hover:pointer-events-auto",
          "focus-within:opacity-100 focus-within:pointer-events-auto"
        )}
      >
        <button
          type="button"
          aria-label="Request rebirth"
          title="Request rebirth"
          class="inline-flex items-center rounded p-[1px] text-secondary-text hover:text-white-text hover:bg-hovered"
          on:click|stopPropagation={() =>
            node && onRequestRebirth(node.group, node.name)}
          on:keypress|stopPropagation
          on:keydown|stopPropagation
        >
          <Icon type="refresh" size={14} />
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          on:click|stopPropagation
          on:keypress|stopPropagation
          on:keydown|stopPropagation
        >
          <DropdownMenu placement="bottom-start">
            <span
              slot="trigger"
              class="inline-flex items-center rounded p-[1px] text-secondary-text hover:text-white-text hover:bg-hovered"
            >
              <Icon type="menu" size={14} />
            </span>
            <div slot="menu-content" class="flex flex-col">
              <DropdownCloseOnClick>
                <DropdownMenuItem
                  onClick={() => node && onRequestRebirth(node.group, node.name)}
                  >Request rebirth</DropdownMenuItem
                >
              </DropdownCloseOnClick>
              <DropdownCloseOnClick>
                <DropdownMenuItem onClick={() => node && onCopyMetricList(node)}
                  >Copy metric list</DropdownMenuItem
                >
              </DropdownCloseOnClick>
            </div>
          </DropdownMenu>
        </div>
      </div>
      <div class="grow"></div>
      {#if node.hasBirth || !node.seqOk}
        <span
          class={twMerge("text-sm", !node.seqOk && "text-warning")}
          title={node.lastSeqGap
            ? `expected ${node.lastSeqGap.expected}, got ${node.lastSeqGap.got}`
            : undefined}
        >
          {node.seqOk ? "seq ok" : "seq gap"}
        </span>
      {/if}
      {#if node.bdSeq !== undefined}
        <span class="text-sm">bdSeq {node.bdSeq}</span>
      {/if}
      <span class="text-sm"
        >{node.metricCount} metric{node.metricCount === 1 ? "" : "s"}</span
      >
    {:else if row.kind === "device" && device}
      <span
        class={twMerge(
          "font-semibold truncate",
          device.online ? "text-white-text" : "text-secondary-text"
        )}>{device.name}</span
      >
      <span
        class={twMerge(
          "size-1.5 rounded-full shrink-0",
          device.online ? "bg-success" : "bg-error"
        )}
      ></span>
      {#if !device.online && deathAtMs !== undefined}
        <span class="text-sm">death {formatAge(deathAtMs, nowMs)} ago</span>
      {/if}
    {:else if row.kind === "metric" && metric}
      {#if metric.placeholder}
        <span
          class="grow min-w-0 truncate text-warning"
          title="unresolved - no birth seen">{metric.name}</span
        >
      {:else}
        <span class="grow min-w-0 truncate">{metric.name}</span>
      {/if}
      <span class="w-16 shrink-0 text-sm">{metric.typeName}</span>
      <span
        class={twMerge(
          "w-24 shrink-0 truncate",
          metric.isNull ? "italic text-secondary-text" : "text-white-text"
        )}
        title={metric.valueRaw !== metric.value ? metric.valueRaw : undefined}
        >{metric.value}</span
      >
      <span class="w-8 shrink-0 text-sm text-right"
        >{formatAge(metric.lastSeenMs, nowMs)}</span
      >
      <span class="w-24 shrink-0 flex gap-2 text-sm">
        {#if metric.stale}
          <span class="text-warning" title="no update for 5 min">stale</span>
        {/if}
        {#if metric.isHistorical}
          <span title="metric flagged historical">historical</span>
        {/if}
        {#if metric.isTransient}
          <span title="metric flagged transient">transient</span>
        {/if}
      </span>
    {/if}
  </div>
</div>
