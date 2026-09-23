<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable, type Writable } from "svelte/store";

  /**
   * Confirms a Sparkplug rebirth request for one or more edge nodes.
   *
   * A rebirth publishes an NCMD to a live node, which resends every birth
   * certificate, and every host application on the broker sees them. That is
   * worth a pause even for one node, and a list of what will be asked when
   * it is many.
   */

  export let isOpen = writable(false);
  /** The edge nodes that will be asked to rebirth. */
  export let targets: { group: string; node: string; offline?: boolean }[] = [];
  /** True while the requests are in flight; the dialog stays open and says so. */
  export let busy = false;
  /** How many requests have gone out, shown as progress while busy. */
  export let sent = 0;
  /** False when the connection is down, so nothing can be published. */
  export let connected = true;
  export let onConfirm: () => Promise<void>;

  // Enough to check a bulk request by eye without the dialog turning into a
  // list view.
  const MAX_LISTED = 10;
  $: isBulk = targets.length > 1;
  $: listed = targets.slice(0, MAX_LISTED);
  $: remaining = Math.max(0, targets.length - listed.length);
  $: single = targets[0];
  $: offlineCount = targets.filter((t) => t.offline).length;

  $: confirmLabel = busy
    ? isBulk
      ? `Requesting ${sent} of ${targets.length}`
      : "Requesting…"
    : isBulk
      ? "Request rebirths"
      : "Request rebirth";

  // The dialog is opened from a store, so melt has no trigger to hand focus
  // back to. Remember what had it (the row button, or the tree) instead.
  // Kept after closing: melt asks for it a tick after the close.
  let opener: HTMLElement | null = null;
  let wasOpen = false;
  $: {
    if ($isOpen && !wasOpen) {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    wasOpen = $isOpen;
  }
  // When the opener is gone (a banner that resolved) or disabled (a row
  // button after a drop), the Sparkplug tree is the next best place.
  const closeFocus = () => {
    const el = opener;
    if (el?.isConnected && !(el as HTMLButtonElement).disabled) return el;
    return document.querySelector<HTMLElement>('[role="tree"][aria-label="Sparkplug nodes"]');
  };

  $: dialogLabel = isBulk
    ? `Request rebirths from ${targets.length} edge nodes`
    : single
      ? `Request a rebirth from ${single.node}`
      : "Request a rebirth";

  const confirm = () => {
    if (busy || !connected) return;
    onConfirm();
  };

  const requestClose = () => {
    if (busy) return;
    isOpen.set(false);
  };

  // Every dismiss path (Escape, overlay click) goes through the store, so a
  // close attempt while busy is swallowed here rather than in each path.
  const guardedIsOpen: Writable<boolean> = {
    subscribe: isOpen.subscribe,
    set: (value) => {
      if (busy && value === false) return;
      isOpen.set(value);
    },
    update: (fn) => {
      isOpen.update((current) => {
        const next = fn(current);
        return busy && next === false ? current : next;
      });
    },
  };
</script>

<Dialog isOpen={guardedIsOpen} startEmpty ariaLabel={dialogLabel} {closeFocus}>
  <div class="relative w-[440px] max-w-[85vw] p-6">
    <h2 class="m-0 pr-6 text-lg font-medium">
      {#if isBulk}
        Request rebirths from {targets.length} edge nodes?
      {:else if single}
        Request a rebirth from <span class="break-all font-mono">{single.node}</span>?
      {/if}
    </h2>
    <IconButton
      class="absolute right-4 top-4"
      disabled={busy}
      onClick={requestClose}
    >
      <Icon type="close" size={16} />
      <span class="sr-only">Close</span>
    </IconButton>
    <div class="mt-4 flex flex-col gap-3 text-secondary-text">
      {#if isBulk}
        <p>
          Each node gets a Node Control/Rebirth command and resends its births,
          so its metrics show names again.
        </p>
        <div
          class="max-h-40 overflow-y-auto rounded border border-outline bg-elevation-0 p-2"
        >
          {#each listed as target (`${target.group}/${target.node}`)}
            <div class="break-all font-mono text-xs text-secondary-text">
              {target.group}/{target.node}{#if target.offline}<span
                  class="font-sans"> (offline)</span
                >{/if}
            </div>
          {/each}
          {#if remaining > 0}
            <div class="pt-1 text-xs text-secondary-text">
              and {remaining} more
            </div>
          {/if}
        </div>
      {:else if single}
        <p>
          This publishes a Node Control/Rebirth command to
          <span class="break-all font-mono text-emphasis"
            >spBv1.0/{single.group}/NCMD/{single.node}</span
          >. The node resends its births, so its metrics show names again.
        </p>
      {/if}
      {#if offlineCount > 0}
        <p class="flex gap-2 text-warning">
          <span class="shrink-0 pt-0.5"><Icon type="warning" size={14} /></span>
          <span>
            {#if isBulk}
              {offlineCount === 1 ? "1 of these nodes is" : `${offlineCount} of these nodes are`}
              offline and won't answer. A node sends its births by itself when it
              reconnects.
            {:else}
              This node is offline and won't answer. It sends its births by itself
              when it reconnects.
            {/if}
          </span>
        </p>
      {/if}
      <p>
        Every host application on this broker sees the new births too. Only
        ask if you're allowed to command {isBulk ? "these nodes" : "this node"}.
      </p>
      {#if !connected}
        <p class="flex gap-2 text-warning">
          <span class="shrink-0 pt-0.5"><Icon type="warning" size={14} /></span>
          <span>Not connected to the broker. Connect first, then ask again.</span>
        </p>
      {/if}
      <div class="flex items-center justify-end gap-3">
        <Button variant="text" disabled={busy} on:click={requestClose}
          >Cancel</Button
        >
        <Button
          iconType="refresh"
          disabled={busy || !connected}
          iconPlacement="left"
          iconSize={16}
          on:click={confirm}>{confirmLabel}</Button
        >
      </div>
    </div>
  </div>
</Dialog>
