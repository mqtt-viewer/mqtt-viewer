<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import ConnectionForm from "./components/ConnectionForm/ConnectionForm.svelte";
  import SubscriptionsForm from "./components/SubscriptionsForm/SubscriptionsForm.svelte";

  export let connection: Connection;
</script>

<div
  class="relative w-full h-full max-w-full py-6 px-6
    flex flex-col overflow-y-auto items-center gap-6
    bg-elevation-1"
>
  <div class="w-[550px]">
    <ConnectionForm {connection} />
  </div>
  <div class="w-[550px]">
    <SubscriptionsForm {connection} />
  </div>
</div>
