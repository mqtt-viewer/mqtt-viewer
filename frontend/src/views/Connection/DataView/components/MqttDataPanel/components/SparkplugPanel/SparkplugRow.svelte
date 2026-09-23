<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import DropdownCloseOnClick from "@/components/DropdownMenu/DropdownCloseOnClick.svelte";
  import { twMerge } from "tailwind-merge";
  import type {
    SparkplugMetric,
    SparkplugNode,
    SparkplugStatus,
  } from "../../stores/sparkplug-tree-store";
  import {
    formatAge,
    formatClockTime,
    needsRebirth,
    type SparkplugTreeRow,
  } from "./build-sparkplug-tree";

  export let row: SparkplugTreeRow;
  /** Reference now for relative ages (from the store snapshot). */
  export let nowMs: number;
  /** This metric row is the one last opened. */
  export let isSelected = false;
  /** Flashes the row after a warning click scrolled to it. */
  export let isHighlighted = false;
  export let onToggleExpansion: (key: string) => void;
  export let onRequestRebirth: (group: string, node: string) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;
  /** Opens the topic of the message that last updated the metric. */
  export let onSelectMetric: (metric: SparkplugMetric, rowKey: string) => void;
  export let onCopyValue: (metric: SparkplugMetric) => void;

  $: node = row.node;
  $: device = row.device;
  $: metric = row.metric;
  $: expandable = row.kind !== "metric";

  const statusDotClass = (status: SparkplugStatus) =>
    status === "online"
      ? "bg-success"
      : status === "offline"
        ? "bg-error"
        : "bg-secondary-text";

  const statusTitle = (
    status: SparkplugStatus,
    deathAtMs: number | undefined
  ) => {
    if (status === "online") return "Online";
    if (status === "offline") {
      return deathAtMs !== undefined
        ? `Offline, death received at ${formatClockTime(deathAtMs)}`
        : "Offline";
    }
    return "Not heard from since the connection dropped, so its state is unknown";
  };

  const activate = () => {
    if (expandable) {
      onToggleExpansion(row.key);
    } else if (metric) {
      onSelectMetric(metric, `${row.key}/${metric.name}`);
    }
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  $: aliasNumber = metric?.placeholder ? metric.name.replace(/^alias_/, "") : "";
</script>

<div
  class={twMerge(
    "group relative flex items-center whitespace-nowrap select-none",
    "overflow-hidden min-w-0 w-full h-[19px] cursor-pointer"
  )}
>
  <span class="w-4 shrink-0 flex justify-center text-secondary-text" aria-hidden="true">
    {#if expandable}
      <span class={row.isExpanded ? "rotate-90" : "rotate-0"}>
        <Icon type="right" size={12} />
      </span>
    {/if}
  </span>
  <div
    role="treeitem"
    tabindex="0"
    aria-level={row.levelCount + 1}
    aria-expanded={expandable ? row.isExpanded : undefined}
    aria-selected={isSelected}
    class={twMerge(
      "text-secondary-text font-thin font-mono text-base ring-inset px-1",
      // Capped so a wide panel doesn't strand the type and age columns
      // far from the name and value they describe.
      "flex grow items-center min-w-0 max-w-[960px] gap-2 h-full",
      "rounded overflow-hidden outline-none",
      "hover:ring-1 hover:ring-secondary-text focus-visible:ring-1 focus-visible:ring-primary",
      isSelected && "ring-1 ring-primary",
      isHighlighted && "bg-hovered"
    )}
    on:click={activate}
    on:keydown={onKeydown}
  >
    {#if row.kind === "group" && row.group}
      <span class="font-semibold text-white-text truncate">{row.group.name}</span>
      <span class="text-sm shrink-0"
        >{row.group.nodes.length} node{row.group.nodes.length === 1 ? "" : "s"}</span
      >
    {:else if row.kind === "node" && node}
      <span
        class={twMerge(
          "font-semibold truncate min-w-0",
          node.status === "offline" ? "text-secondary-text" : "text-white-text"
        )}>{node.name}</span
      >
      <span
        class={twMerge("size-1.5 rounded-full shrink-0", statusDotClass(node.status))}
        title={statusTitle(node.status, node.deathAtMs)}
        role="img"
        aria-label={statusTitle(node.status, node.deathAtMs)}
      ></span>
      {#if node.status === "offline" && node.deathAtMs !== undefined}
        <span class="text-sm shrink-0">death {formatAge(node.deathAtMs, nowMs)} ago</span>
      {/if}
      {#if node.storm}
        <span class="text-sm text-warning shrink-0" title="4 or more births in 90 seconds. Two clients sharing one client id is the usual cause."
          >rebirth storm</span
        >
      {/if}
      {#if !node.seqOk}
        <span
          class="text-sm text-warning shrink-0"
          title={node.lastSeqGap
            ? `Expected seq ${node.lastSeqGap.expected}, got ${node.lastSeqGap.got}. Messages were lost or reordered.`
            : "Messages were lost or reordered"}>seq gap</span
        >
      {/if}
      {#if !node.hasBirth && node.placeholderCount > 0}
        <span
          class="text-sm text-warning shrink-0"
          title="No birth seen for this node since connecting, so its metrics show aliases. A rebirth fixes it."
          >no birth</span
        >
      {:else if node.hasBirth && !node.verified}
        <span
          class="text-sm text-warning shrink-0"
          title="Names come from a birth received before the connection dropped. If the node rebirthed while disconnected they may be wrong until its next birth."
          >unverified</span
        >
      {/if}
      <div class="grow"></div>
      {#if node.bdSeq !== undefined}
        <span class="text-sm shrink-0" title="Birth/death sequence number">bdSeq {node.bdSeq}</span>
      {/if}
      <span class="text-sm shrink-0"
        >{node.metricCount} metric{node.metricCount === 1 ? "" : "s"}{#if node.devices.length > 0},
          {node.devices.length} device{node.devices.length === 1 ? "" : "s"}{/if}</span
      >
      <!-- Hover-revealed node actions (same affordance pattern as the $SYS
           row's broker-status button in MqttTopicRow). Focusable, so keyboard
           users reach them by tabbing through the row. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={twMerge(
          "flex items-center gap-1 shrink-0",
          "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        )}
        on:click|stopPropagation
        on:keydown|stopPropagation
      >
        <button
          type="button"
          aria-label={`Request a rebirth from ${node.name}`}
          title={needsRebirth(node)
            ? "Request a rebirth to resolve names"
            : "Request a rebirth"}
          class={twMerge(
            "inline-flex items-center rounded p-[1px] hover:text-white-text hover:bg-hovered",
            needsRebirth(node) ? "text-warning" : "text-secondary-text"
          )}
          on:click={() => node && onRequestRebirth(node.group, node.name)}
        >
          <Icon type="refresh" size={14} />
        </button>
        <DropdownMenu placement="bottom-start">
          <span
            slot="trigger"
            class="inline-flex items-center rounded p-[1px] text-secondary-text hover:text-white-text hover:bg-hovered"
            aria-label={`More actions for ${node.name}`}
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
    {:else if row.kind === "device" && device}
      <span
        class={twMerge(
          "font-semibold truncate min-w-0",
          device.status === "offline" ? "text-secondary-text" : "text-white-text"
        )}>{device.name}</span
      >
      <span
        class={twMerge("size-1.5 rounded-full shrink-0", statusDotClass(device.status))}
        title={statusTitle(device.status, device.deathAtMs)}
        role="img"
        aria-label={statusTitle(device.status, device.deathAtMs)}
      ></span>
      {#if device.status === "offline" && device.deathAtMs !== undefined}
        <span class="text-sm shrink-0">death {formatAge(device.deathAtMs, nowMs)} ago</span>
      {/if}
      {#if device.awaitingBirth}
        <span
          class="text-sm text-warning shrink-0"
          title="Its node rebirthed and this device hasn't sent its own birth yet"
          >awaiting birth</span
        >
      {:else if !device.hasBirth && device.placeholderCount > 0}
        <span
          class="text-sm text-warning shrink-0"
          title="No birth seen for this device since connecting, so its metrics show aliases. A rebirth of its node fixes it."
          >no birth</span
        >
      {:else if device.hasBirth && !device.verified}
        <span
          class="text-sm text-warning shrink-0"
          title="Names come from a birth received before the connection dropped"
          >unverified</span
        >
      {/if}
      <div class="grow"></div>
      <span class="text-sm shrink-0"
        >{device.metrics.length} metric{device.metrics.length === 1 ? "" : "s"}</span
      >
    {:else if row.kind === "metric" && metric}
      {#if metric.placeholder}
        <span
          class="w-[38%] shrink-0 truncate italic"
          title={`Alias ${aliasNumber}. No birth seen since connecting, so the name is unknown.`}
          >alias {aliasNumber}</span
        >
      {:else}
        <span class="w-[38%] shrink-0 truncate" title={metric.name}>{metric.name}</span>
      {/if}
      <span
        class={twMerge(
          "grow min-w-0 truncate",
          metric.isNull ? "italic text-secondary-text" : "text-white-text"
        )}
        title={metric.valueRaw}
        >{metric.value}{#if metric.unit}<span class="ml-1 text-secondary-text">{metric.unit}</span>{/if}</span
      >
      {#if metric.quality}
        <span
          class="text-sm text-warning shrink-0"
          title={`Published quality ${metric.qualityCode}`}>{metric.quality}</span
        >
      {/if}
      {#if metric.isHistorical}
        <span class="text-sm shrink-0" title="Flagged historical: a backfilled value, not the live one"
          >historical</span
        >
      {/if}
      {#if metric.isTransient}
        <span class="text-sm shrink-0" title="Flagged transient: not meant to be stored"
          >transient</span
        >
      {/if}
      <span class="w-24 shrink-0 text-sm truncate">{metric.typeName}</span>
      <span
        class="w-9 shrink-0 text-sm text-right"
        title={`Last updated ${formatClockTime(metric.lastSeenMs)}`}
        >{formatAge(metric.lastSeenMs, nowMs)}</span
      >
      <button
        type="button"
        aria-label={`Copy the value of ${metric.name}`}
        title="Copy value"
        class={twMerge(
          "inline-flex items-center rounded p-[1px] shrink-0 text-secondary-text",
          "hover:text-white-text hover:bg-hovered",
          "opacity-0 group-hover:opacity-100 focus:opacity-100"
        )}
        on:click|stopPropagation={() => metric && onCopyValue(metric)}
        on:keydown|stopPropagation
      >
        <Icon type="copy" size={12} />
      </button>
    {/if}
  </div>
</div>
