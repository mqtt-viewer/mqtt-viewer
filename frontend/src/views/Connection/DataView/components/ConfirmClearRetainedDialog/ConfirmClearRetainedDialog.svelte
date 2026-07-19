<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable } from "svelte/store";

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
  export let onConfirm: () => void;

  $: isBranch = count > 0;

  const confirm = () => {
    onConfirm();
    isOpen.set(false);
  };
</script>

<Dialog
  {isOpen}
  title={isBranch
    ? `Clear retained messages below ${topic}?`
    : "Clear retained message?"}
>
  <div class="mt-3 flex flex-col gap-3">
    {#if isBranch}
      <p>
        I'll clear {count} retained {count === 1 ? "message" : "messages"} that I
        know about below this topic.
      </p>
      <!-- The hedge is load-bearing, not padding. Under MQTT 3 the retained
           flag only arrives on subscribe-time replay, so a topic another client
           retained mid-session is genuinely invisible to us. Promising a clean
           sweep here would be a lie. -->
      <p>
        If a client retained something here that I haven't seen, I won't clear
        it.
      </p>
    {:else}
      <p>
        I'll publish an empty retained message to <span class="text-emphasis"
          >{topic}</span
        >, which tells the broker to drop its retained value.
      </p>
    {/if}
    <p>This cannot be undone.</p>
    <div class="flex items-center justify-end gap-3">
      <Button variant="text" on:click={() => isOpen.set(false)}>Cancel</Button>
      <Button
        iconType="delete"
        class="text-error enabled:hover:text-error-light enabled:group-hover:text-error-light"
        iconPlacement="left"
        iconSize={16}
        on:click={confirm}>Clear</Button
      >
    </div>
  </div>
</Dialog>
