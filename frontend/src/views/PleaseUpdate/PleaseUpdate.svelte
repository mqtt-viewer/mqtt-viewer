<script lang="ts">
  import Button from "@/components/Button/Button.svelte";
  import updateStore from "@/stores/update";
  import { BrowserOpenURL } from "wailsjs/runtime/runtime";
</script>

<div
  class="size-full flex flex-col justify-center items-center"
  style="--wails-draggable:drag"
>
  <div>MQTT Viewer is now out of beta!</div>
  <div class="h-5"></div>
  <div class="flex items-center">
    Please <span class="inline-block mx-2">
      {#if $updateStore.availableUpdate !== null}
        <Button on:click={() => updateStore.openUpdateDialog()}
          >Update Now</Button
        >
      {:else}
        <Button
          on:click={() => BrowserOpenURL("https://mqttviewer.app/download")}
          >Download</Button
        >
      {/if}
    </span> to continue using the app.
  </div>
</div>
