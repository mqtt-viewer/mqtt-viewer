<script lang="ts">
  import PageHeaderBar from "@/components/PageHeaderBar/PageHeaderBar.svelte";
  import connections from "@/stores/connections";
  import Icon from "@/components/Icon/Icon.svelte";
  import Button from "@/components/Button/Button.svelte";

  let className = "";
  export { className as class };
</script>

<PageHeaderBar>
  <div class="relative size-full flex items-center justify-center">
    <span class="font-semibold">Connections</span>
    <Button
      class="absolute top-1/2 -translate-y-1/2 right-5 flex items-center gap-2"
      on:click={() => connections.addConnection()}
      ><Icon type="plus" />Add Connection
    </Button>
  </div>
</PageHeaderBar>
