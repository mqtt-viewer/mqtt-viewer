<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable, type Writable } from "svelte/store";

  /**
   * Confirms clearing retained messages, for a single topic or for everything
   * known-retained below a prefix.
   *
   * Clearing publishes an empty retained message, which tells the broker to
   * drop its retained value. That reaches every other client on the broker, so
   * it is confirmed even for a single topic.
   */

  export let isOpen = writable(false);
  /** The topic being cleared, or the prefix when clearing a branch. */
  export let topic = "";
  /**
   * Number of topics that will be cleared. 0 means the single-topic case.
   * For a branch this is what we counted when the menu opened, and it is what
   * gets cleared: exactly these topics, not whatever matches the prefix later.
   */
  export let count = 0;
  /**
   * The exact topics a branch clear will publish tombstones to. Listed so the
   * number can be checked rather than taken on trust.
   */
  export let topics: string[] = [];
  /**
   * True while the clear is in flight. Every topic is its own QoS 1 publish,
   * so a branch sweep takes real time. The dialog stays put and says so,
   * rather than vanishing and leaving the outcome to a toast that arrives
   * much later.
   */
  export let busy = false;
  export let onConfirm: () => Promise<void>;

  $: isBranch = count > 0;

  // Enough topics to check a typical branch by eye, few enough that the dialog
  // does not turn into a list view.
  const MAX_LISTED = 10;
  $: listed = topics.slice(0, MAX_LISTED);
  $: remaining = Math.max(0, topics.length - listed.length);

  // Closing belongs to the parent now: it owns the call and only learns the
  // outcome when that resolves.
  const confirm = () => {
    if (busy) return;
    onConfirm();
  };

  const requestClose = () => {
    if (busy) return;
    isOpen.set(false);
  };

  // Dialog's own dismiss paths (Escape, an overlay click, its built-in close
  // button) all go through whatever store it was built with — melt calls
  // `.set(false)` on it directly, bypassing requestClose above entirely. This
  // wraps isOpen so a close attempt while busy is swallowed regardless of
  // which path it comes from, without needing Dialog itself to know about
  // busy state. startEmpty below then supplies our own title/close button so
  // the topic can render in monospace inside it, which Dialog's plain-string
  // title prop can't do.
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
  <div class="relative w-[420px] max-w-[85vw] p-6">
    <h2 class="m-0 pr-6 text-lg font-medium">
      {#if isBranch}
        Clear retained messages below
        <span class="break-all font-mono">{topic}</span>?
      {:else}
        Clear retained message?
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
      {#if isBranch}
        <p>
          This will clear {count} retained {count === 1 ? "message" : "messages"}
          known to this client below
          <span class="break-all font-mono text-emphasis">{topic}</span>.
        </p>
        {#if listed.length > 0}
          <div
            class="max-h-40 overflow-y-auto rounded border border-outline bg-elevation-0 p-2"
          >
            {#each listed as listedTopic (listedTopic)}
              <div class="break-all font-mono text-xs text-secondary-text">
                {listedTopic}
              </div>
            {/each}
            {#if remaining > 0}
              <div class="pt-1 text-xs text-secondary-text">
                and {remaining} more
              </div>
            {/if}
          </div>
        {/if}
        <!-- The hedge is load-bearing, not padding. Under MQTT 3 the retained
             flag only arrives on subscribe-time replay, so a topic another
             client retained mid-session is genuinely invisible to us.
             Promising a clean sweep here would be a lie. -->
        <p>
          Retained messages this client has not seen are left as they are.
        </p>
      {:else}
        <p>
          This publishes an empty retained message to <span
            class="break-all font-mono text-emphasis">{topic}</span
          >, which tells the broker to drop its retained value.
        </p>
      {/if}
      <p>This cannot be undone.</p>
      <div class="flex items-center justify-end gap-3">
        <Button variant="text" disabled={busy} on:click={requestClose}
          >Cancel</Button
        >
        <Button
          iconType="delete"
          disabled={busy}
          class="text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
          iconPlacement="left"
          iconSize={16}
          on:click={confirm}>{busy ? "Clearing…" : "Clear"}</Button
        >
      </div>
    </div>
  </div>
</Dialog>
