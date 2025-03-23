<script lang="ts">
  import { getContext } from "svelte";
  import { createDropdownMenu, melt } from "@melt-ui/svelte";

  const elements = getContext("menu-elements") as ReturnType<
    typeof createDropdownMenu
  >["elements"];
  const { item } = elements;
</script>

<button use:melt={$item}>
  <slot />
</button>
