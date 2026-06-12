<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";

  export let onClick: () => void;
</script>

<div class="px-2 pt-2 pb-3">
  <button
    class="flex items-center gap-2 w-full px-1 py-1 rounded text-white-text hover:bg-hovered"
    on:click={onClick}
  >
    <Icon type="plusCircle" size={22} />
    <span class="text-base">New message</span>
  </button>
</div>
