<script lang="ts">
  import EnvStore from "@/stores/env";
  import LicenseStatus from "./components/LicenseStatus.svelte";
  import MessageStats from "./components/MessageStats.svelte";
  import { whatsNewOpen } from "@/components/WhatsNewDialog/WhatsNewDialog.svelte";
</script>

<div
  class="w-full h-[18px] min-h-[18px] bg-elevation-1/80 flex
    justify-end items-center gap-2 px-2
    text-secondary-text text-xs"
>
  <MessageStats />
  <div class="flex-grow" />
  <LicenseStatus />
  <button
    class="hover:text-emphasis transition-colors"
    title="What's new"
    on:click={() => whatsNewOpen.set(true)}>{$EnvStore.version}</button
  >
</div>
