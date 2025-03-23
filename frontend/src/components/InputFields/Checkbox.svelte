<script lang="ts">
  import { createCheckbox, melt } from "@melt-ui/svelte";
  import Icon from "../Icon/Icon.svelte";
  import { writable } from "svelte/store";

  export let label = "" as string;
  export let checked = writable(false);

  const {
    elements: { root, input },
    helpers: { isChecked, isIndeterminate },
  } = createCheckbox({
    checked,
  });
</script>

<div class="flex items-center justify-center">
  <button
    use:melt={$root}
    class="flex appearance-none items-center justify-center rounded-sm
             h-5 w-5 hover:opacity-75 ring-1 ring-inset ring-white"
    id="checkbox"
  >
    {#if $isIndeterminate}
      <Icon type="unticked" size={16} />
    {:else if $isChecked}
      <Icon type="tickSquare" size={16} />
    {/if}
    <input use:melt={$input} />
  </button>
  {#if label}
    <label class="pl-2" for="checkbox">
      {label}
    </label>
  {/if}
</div>
