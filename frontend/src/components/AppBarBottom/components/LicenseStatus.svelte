<script lang="ts">
  import env from "@/stores/env";
</script>

{#if $env.isBeta}
  <span class="cursor-default"> BETA </span>
{/if}
