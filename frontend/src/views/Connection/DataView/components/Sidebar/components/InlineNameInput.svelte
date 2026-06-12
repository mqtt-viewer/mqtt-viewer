<script lang="ts">
  import BaseInput from "@/components/InputFields/BaseInput.svelte";

  export let name: string;
  export let initialValue = "";
  export let placeholder = "";
  export let onCommit: (value: string) => void;
  export let onCancel: () => void = () => {};

  let value = initialValue;
  let isActive = true;

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
  <BaseInput bind:value {name} {placeholder} autofocus onBlur={commit} />
</form>
