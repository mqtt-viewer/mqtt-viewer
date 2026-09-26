<script lang="ts">
  import { onDestroy } from "svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { twMerge } from "tailwind-merge";
  import type {
    SparkplugMetric,
    SparkplugNode,
    SparkplugStatus,
  } from "../../stores/sparkplug-tree-store";
  import { formatDateTime } from "../../stores/sparkplug-values";
  import {
    formatAge,
    formatClockTime,
    metricLabel,
    needsRebirth,
    type SparkplugTreeRow,
  } from "./build-sparkplug-tree";

  export let row: SparkplugTreeRow;
  /** Reference now for relative ages (from the store snapshot). */
  export let nowMs: number;
  /** DOM id, for the tree's aria-activedescendant. */
  export let domId: string;
  /** This metric row is the one last opened. */
  export let isSelected = false;
  /** The keyboard cursor is on this row. */
  export let isActive = false;
  /** The tree has keyboard focus, so the active row shows a focus ring. */
  export let treeFocused = false;
  /** Flashes the row after a warning click scrolled to it. */
  export let isHighlighted = false;
  /**
   * Narrow panel: the type column goes and status badges fold into one
   * warning icon, so names and values keep their room.
   */
  export let compact = false;
  /** The broker connection is up, so a rebirth can be requested. */
  export let connected = true;
  /** A click on the row: moves the keyboard cursor here and acts on it. */
  export let onActivate: (row: SparkplugTreeRow) => void;
  export let onRequestRebirth: (node: SparkplugNode) => void;
  export let onCopyMetricList: (node: SparkplugNode) => void;
  export let onCopyValue: (metric: SparkplugMetric) => void;

  $: node = row.node;
  $: device = row.device;
  $: metric = row.metric;
  $: expandable = row.kind !== "metric";
  // Row actions are hidden until hover, and only the active row's are in the
  // tab order, so Tab leaves the tree instead of walking every rendered row.
  $: actionTabIndex = isActive ? 0 : -1;
  $: showActions = isActive && treeFocused;

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

  interface Badge {
    label: string;
    title: string;
  }

  const nodeBadges = (n: SparkplugNode): Badge[] => {
    const badges: Badge[] = [];
    if (n.storm) {
      badges.push({
        label: "rebirth storm",
        title: "4 or more births in 90 seconds. Two clients sharing one client id is the usual cause.",
      });
    }
    if (!n.seqOk) {
      badges.push({
        label: "seq gap",
        title: n.lastSeqGap
          ? `Expected seq ${n.lastSeqGap.expected}, got ${n.lastSeqGap.got}. Messages were lost or reordered.`
          : "Messages were lost or reordered",
      });
    }
    if (!n.hasBirth && n.placeholderCount > 0) {
      badges.push({
        label: "no birth",
        title: "No birth seen for this node since connecting, so its metrics show aliases. A rebirth fixes it.",
      });
    } else if (n.hasBirth && !n.verified) {
      badges.push({
        label: "unverified",
        title: "Names come from a birth received before the connection dropped. If the node rebirthed while disconnected they may be wrong until its next birth.",
      });
    }
    return badges;
  };

  const deviceBadges = (d: NonNullable<SparkplugTreeRow["device"]>): Badge[] => {
    if (d.awaitingBirth) {
      return [
        {
          label: "awaiting birth",
          title: "Its node rebirthed and this device hasn't sent its own birth yet",
        },
      ];
    }
    if (!d.hasBirth && d.placeholderCount > 0) {
      return [
        {
          label: "no birth",
          title: "No birth seen for this device since connecting, so its metrics show aliases. A rebirth of its node fixes it.",
        },
      ];
    }
    if (d.hasBirth && !d.verified) {
      return [
        {
          label: "unverified",
          title: "Names come from a birth received before the connection dropped",
        },
      ];
    }
    return [];
  };

  $: badges =
    row.kind === "node" && node
      ? nodeBadges(node)
      : row.kind === "device" && device
        ? deviceBadges(device)
        : [];
  $: badgeSummary = badges.map((b) => b.label).join(", ");

  // A long metric name loses its end to the ellipsis, and with folder-style
  // names ("Line 1/Filler/Motor/Current") the end is what tells siblings
  // apart. The last segment keeps its room and the folders give way first.
  $: label = metric ? metricLabel(metric) : "";
  $: slash = metric && !metric.placeholder ? label.lastIndexOf("/") : -1;
  $: labelPrefix = slash > 0 ? label.slice(0, slash + 1) : "";
  $: labelLeaf = slash > 0 ? label.slice(slash + 1) : label;

  $: ageTitle = metric
    ? metric.payloadTsMs !== undefined
      ? `Received ${formatClockTime(metric.lastSeenMs)}. The node timestamped it ${formatDateTime(metric.payloadTsMs)}.`
      : `Received ${formatClockTime(metric.lastSeenMs)}`
    : "";

  $: rebirthDisabled = !connected || node?.status === "offline";
  $: rebirthTitle = !connected
    ? "Not connected"
    : node?.status === "offline"
      ? "Offline. A node sends its births by itself when it reconnects."
      : node && needsRebirth(node)
        ? "Request a rebirth to resolve names"
        : "Request a rebirth";

  // The virtual list reuses a row's DOM for whatever row scrolls or shifts
  // into its slot. If one of this row's buttons has focus when that happens,
  // it would silently act on a different node, so focus goes back to the
  // tree, whose cursor still follows the row it was on.
  let rowElement: HTMLDivElement;
  let shownRowId = row.id;
  $: if (row.id !== shownRowId) {
    shownRowId = row.id;
    const focused = document.activeElement;
    if (rowElement && focused instanceof HTMLElement && focused !== rowElement && rowElement.contains(focused)) {
      (rowElement.closest('[role="tree"]') as HTMLElement | null)?.focus();
    }
  }

  // A row can also leave the list outright (a filter drops it, a birth
  // resolves the problem that listed it). Focus on one of its buttons would
  // fall to the page, so it goes to the tree.
  onDestroy(() => {
    const focused = document.activeElement;
    if (!rowElement || !(focused instanceof HTMLElement) || !rowElement.contains(focused)) return;
    const tree = rowElement.closest('[role="tree"]') as HTMLElement | null;
    queueMicrotask(() => {
      const now = document.activeElement;
      if (tree?.isConnected && (now === null || now === document.body)) tree.focus();
    });
  });

  // The row's accessible name, without its action buttons' labels.
  $: accessibleName = (() => {
    if (row.kind === "group" && row.group) {
      return `${row.group.name}, ${row.group.nodes.length} node${row.group.nodes.length === 1 ? "" : "s"}`;
    }
    const scope = row.kind === "node" ? node : row.kind === "device" ? device : undefined;
    if (scope) {
      const parts = [scope.name, scope.status, ...badges.map((b) => b.label)];
      const count = row.kind === "node" && node ? node.metricCount : scope.metrics.length;
      parts.push(`${count} metric${count === 1 ? "" : "s"}`);
      return parts.join(", ");
    }
    if (metric) {
      const parts = [label, `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`];
      if (metric.quality) parts.push(metric.quality);
      if (metric.typeName) parts.push(metric.typeName);
      return parts.join(", ");
    }
    return "";
  })();

  const actionButtonClass =
    "inline-flex items-center rounded p-[1px] hover:text-white-text hover:bg-hovered disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-secondary-text";
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
  <!-- Focus stays on the tree; this row is its aria-activedescendant, so it
       takes no tabindex (a focusable row would steal focus on click). -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    id={domId}
    bind:this={rowElement}
    role="treeitem"
    aria-label={accessibleName}
    aria-level={row.levelCount + 1}
    aria-expanded={expandable ? row.isExpanded : undefined}
    aria-selected={isSelected}
    class={twMerge(
      "text-secondary-text font-thin font-mono text-base ring-inset px-1",
      // Capped so a wide panel doesn't strand the type and age columns
      // far from the name and value they describe.
      "flex grow items-center min-w-0 max-w-[960px] gap-2 h-full",
      "rounded overflow-hidden outline-none",
      "hover:ring-1 hover:ring-secondary-text",
      isSelected && "ring-1 ring-primary",
      isActive && treeFocused && "ring-1 ring-primary bg-hovered",
      isHighlighted && "bg-hovered"
    )}
    on:click={() => onActivate(row)}
  >
    {#if row.kind === "group" && row.group}
      <span class="font-semibold text-white-text truncate">{row.group.name}</span>
      <span class="text-sm shrink-0"
        >{row.group.nodes.length} node{row.group.nodes.length === 1 ? "" : "s"}</span
      >
    {:else if (row.kind === "node" && node) || (row.kind === "device" && device)}
      {@const scope = row.kind === "node" ? node : device}
      {#if scope}
        <span
          class={twMerge(
            "font-semibold truncate min-w-0",
            scope.status === "offline" ? "text-secondary-text" : "text-white-text"
          )}>{scope.name}</span
        >
        <span
          class={twMerge("size-1.5 rounded-full shrink-0", statusDotClass(scope.status))}
          title={statusTitle(scope.status, scope.deathAtMs)}
          role="img"
          aria-label={statusTitle(scope.status, scope.deathAtMs)}
        ></span>
        {#if scope.status === "offline" && scope.deathAtMs !== undefined && !compact}
          <span class="text-sm shrink-0">death {formatAge(scope.deathAtMs, nowMs)} ago</span>
        {/if}
        {#if compact && badges.length > 0}
          <span
            class="shrink-0 text-warning inline-flex"
            title={badges.map((b) => `${b.label}: ${b.title}`).join("\n")}
            role="img"
            aria-label={badgeSummary}><Icon type="warning" size={12} /></span
          >
        {:else}
          {#each badges as badge (badge.label)}
            <span class="text-sm font-normal text-warning shrink-0" title={badge.title}
              >{badge.label}</span
            >
          {/each}
        {/if}
        <div class="grow"></div>
        {#if row.kind === "node" && node}
          {#if node.bdSeq !== undefined && !compact}
            <span class="text-sm shrink-0" title="Birth/death sequence number">bdSeq {node.bdSeq}</span>
          {/if}
          <span
            class="text-sm shrink-0"
            title={`${node.metricCount} metric${node.metricCount === 1 ? "" : "s"}, ${node.devices.length} device${node.devices.length === 1 ? "" : "s"}`}
            >{node.metricCount}{compact ? "" : node.metricCount === 1 ? " metric" : " metrics"}{#if node.devices.length > 0 && !compact},
              {node.devices.length} device{node.devices.length === 1 ? "" : "s"}{/if}</span
          >
          <!-- Hover-revealed node actions (same affordance pattern as the $SYS
               row's broker-status button in MqttTopicRow). Keyboard users get
               them on the active row. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class={twMerge(
              "flex items-center gap-1 shrink-0 text-secondary-text",
              "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              showActions && "opacity-100"
            )}
            on:click|stopPropagation
          >
            <button
              type="button"
              tabindex={actionTabIndex}
              aria-label={`Request a rebirth from ${node.name}`}
              title={rebirthTitle}
              disabled={rebirthDisabled}
              class={twMerge(
                actionButtonClass,
                needsRebirth(node) && !rebirthDisabled && "text-warning"
              )}
              on:click={() => node && onRequestRebirth(node)}
            >
              <Icon type="refresh" size={14} />
            </button>
            <button
              type="button"
              tabindex={actionTabIndex}
              aria-label={`Copy the metric list of ${node.name}`}
              title="Copy metric list as JSON"
              class={actionButtonClass}
              on:click={() => node && onCopyMetricList(node)}
            >
              <Icon type="copy" size={14} />
            </button>
          </div>
        {:else if device}
          <span
            class="text-sm shrink-0"
            title={`${device.metrics.length} metric${device.metrics.length === 1 ? "" : "s"}`}
            >{device.metrics.length}{compact ? "" : device.metrics.length === 1 ? " metric" : " metrics"}</span
          >
        {/if}
      {/if}
    {:else if row.kind === "metric" && metric}
      <span
        class={twMerge(
          "shrink-0 flex min-w-0",
          compact ? "w-[45%]" : "w-[38%]",
          metric.placeholder && "italic"
        )}
        title={metric.placeholder
          ? `Alias ${metric.name.replace(/^alias_/, "")}. No birth seen since connecting, so the name is unknown.`
          : metric.name}
      >
        {#if labelPrefix}<span class="truncate min-w-0">{labelPrefix}</span>{/if}<span
          class="truncate min-w-0 shrink-0 max-w-full">{labelLeaf}</span
        >
      </span>
      <span
        class={twMerge(
          "grow min-w-0 truncate",
          metric.isNull || metric.omitted ? "italic text-secondary-text" : "text-white-text"
        )}
        title={metric.omitted ? metric.value : metric.valueRaw}
        >{metric.value}{#if metric.unit}<span class="ml-1 text-secondary-text">{metric.unit}</span>{/if}</span
      >
      {#if metric.quality}
        <span
          class="text-sm font-normal text-warning shrink-0"
          title={`Published quality ${metric.qualityCode}`}>{metric.quality}</span
        >
      {/if}
      {#if metric.isHistorical && !compact}
        <span class="text-sm shrink-0" title="Flagged historical: a backfilled value, not the live one"
          >historical</span
        >
      {/if}
      {#if metric.isTransient && !compact}
        <span class="text-sm shrink-0" title="Flagged transient: not meant to be stored"
          >transient</span
        >
      {/if}
      {#if !compact}
        <span class="w-24 shrink-0 text-sm truncate">{metric.typeName}</span>
      {/if}
      <span class="w-9 shrink-0 text-sm text-right" title={ageTitle}
        >{formatAge(metric.lastSeenMs, nowMs)}</span
      >
      {#if !metric.omitted}
      <button
        type="button"
        tabindex={actionTabIndex}
        aria-label={`Copy the value of ${label}`}
        title="Copy value"
        class={twMerge(
          "inline-flex items-center rounded p-[1px] shrink-0 text-secondary-text",
          "hover:text-white-text hover:bg-hovered",
          "opacity-0 group-hover:opacity-100 focus:opacity-100",
          showActions && "opacity-100"
        )}
        on:click|stopPropagation={() => metric && onCopyValue(metric)}
      >
        <Icon type="copy" size={12} />
      </button>
      {/if}
    {/if}
  </div>
</div>
