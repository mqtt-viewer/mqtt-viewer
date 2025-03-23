<script lang="ts">
  import EnvStore from "@/stores/env";
  import LicenseStatus from "./components/LicenseStatus.svelte";
  import MessageStats from "./components/MessageStats.svelte";
</script>

<div
  class="w-full h-[18px] min-h-[18px] bg-elevation-1/80 flex
    justify-end items-center gap-2 px-2
    text-secondary-text text-xs"
>
  <MessageStats />
  <div class="flex-grow" />
  <LicenseStatus />
  <span class="cursor-default">{$EnvStore.version}</span>
</div>
