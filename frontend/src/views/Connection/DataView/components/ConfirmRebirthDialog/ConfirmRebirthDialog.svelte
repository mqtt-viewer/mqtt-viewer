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
  export let targets: { group: string; node: string }[] = [];
  /** True while the requests are in flight; the dialog stays open and says so. */
  export let busy = false;
  export let onConfirm: () => Promise<void>;

  // Enough to check a bulk request by eye without the dialog turning into a
  // list view.
  const MAX_LISTED = 10;
  $: isBulk = targets.length > 1;
  $: listed = targets.slice(0, MAX_LISTED);
  $: remaining = Math.max(0, targets.length - listed.length);
  $: single = targets[0];

  const confirm = () => {
    if (busy) return;
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

<Dialog isOpen={guardedIsOpen} startEmpty>
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
    </IconButton>
    <div class="mt-4 flex flex-col gap-3 text-secondary-text">
      {#if isBulk}
        <p>
          Each one gets a Node Control/Rebirth command and resends its births,
          so their metrics show names again.
        </p>
        <div
          class="max-h-40 overflow-y-auto rounded border border-outline bg-elevation-0 p-2"
        >
          {#each listed as target (`${target.group}/${target.node}`)}
            <div class="break-all font-mono text-xs text-secondary-text">
              {target.group}/{target.node}
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
      <p>
        Every host application on this broker sees the new births too. Only
        ask if you're allowed to command these nodes.
      </p>
      <div class="flex items-center justify-end gap-3">
        <Button variant="text" disabled={busy} on:click={requestClose}
          >Cancel</Button
        >
        <Button
          iconType="refresh"
          disabled={busy}
          iconPlacement="left"
          iconSize={16}
          on:click={confirm}
          >{busy ? "Requesting…" : isBulk ? "Request rebirths" : "Request rebirth"}</Button
        >
      </div>
    </div>
  </div>
</Dialog>
