<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";

  export let onClick: () => void;
</script>

<div class="px-3 pt-2 pb-3 flex">
  <button
    class="flex items-center gap-2 grow px-1 -mx-1 py-1 rounded text-white-text hover:bg-hovered"
    on:click={onClick}
  >
    <span class="w-5 shrink-0 flex items-center justify-center text-primary">
      <Icon type="plusCircle" size={20} />
    </span>
    <span class="text-base">New message</span>
  </button>
</div>
