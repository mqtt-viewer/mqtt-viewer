<script lang="ts">
  import { onMount, tick } from "svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";

  export let name: string;
  export let initialValue = "";
  export let placeholder = "";
  export let onCommit: (value: string) => void;
  export let onCancel: () => void = () => {};
  // Select the prefilled text once on mount so typing replaces it.
  export let selectAll = false;

  let value = initialValue;
  let isActive = true;
  let inputEl: HTMLInputElement | undefined;

  onMount(async () => {
    if (!selectAll) return;
    // autofocus lands after mount; wait a tick so the selection sticks.
    await tick();
    inputEl?.select();
  });

  // Enter triggers both submit and blur — commit exactly once.
  const commit = () => {
    if (!isActive) return;
    isActive = false;
    onCommit(value.trim());
  };

  const cancel = () => {
    if (!isActive) return;
    isActive = false;
    onCancel();
  };
</script>

<form
  role="presentation"
  class="w-full"
  on:submit|preventDefault={commit}
  on:keydown={(e) => e.key === "Escape" && cancel()}
>
  <!-- svelte-ignore a11y_autofocus -->
  <BaseInput
    bind:value
    bind:inputEl
    {name}
    {placeholder}
    autofocus
    onBlur={commit}
  />
</form>
