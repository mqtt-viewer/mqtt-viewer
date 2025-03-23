<script lang="ts">
  import CodeEditor from "@/components/CodeEditor/CodeEditor.svelte";
  import CodeEditorConfigBar from "@/components/CodeEditor/CodeEditorConfigBar.svelte";
  import type { PublishDetailsStore } from "../stores/publish-details";

  export let publishStore: PublishDetailsStore;

  let setEditorText = (text: string) => {};
  let lastSetEditorIncrement = 0;
  $: $publishStore.forceEditorTextSetIncrement,
    (() => {
      if ($publishStore.forceEditorTextSetIncrement === lastSetEditorIncrement)
        return;
      lastSetEditorIncrement = $publishStore.forceEditorTextSetIncrement;
      setEditorText($publishStore.payload);
    })();
</script>

<div
  class="size-full max-h-full min-h-0 max-w-full flex flex-col overflow-hidden
        border border-outline rounded-sm p-[1px]"
>
  <CodeEditorConfigBar
    textToCopy={$publishStore.payload}
    bind:codec={$publishStore.codec}
    bind:format={$publishStore.format}
    formatPayload={() => {
      publishStore.formatPayload();
      $publishStore.forceEditorTextSetIncrement++;
    }}
  />
  <div class="grow w-full min-h-0">
    <CodeEditor
      bind:setEditorText
      bind:text={$publishStore.payload}
      format={$publishStore.format}
    />
  </div>
</div>
