<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import tokens from "../design-system/design-tokens.json";

  const { Story } = defineMeta({
    title: "Foundations/Tokens",
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

<Story name="Tokens" asChild>
  <div class="min-h-screen bg-elevation-0 p-8 text-white-text">
    <div class="mb-8">
      <h1 class="text-xl font-semibold">Colors</h1>
      <div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {#each Object.entries(tokens.color) as [name, value]}
          <div class="rounded border border-outline bg-elevation-1-card p-3">
            <div
              class="h-14 rounded border border-outline"
              style:background={value}
            ></div>
            <div class="mt-2 text-sm text-white-text">{name}</div>
            <div class="text-xs text-secondary-text">{value}</div>
          </div>
        {/each}
      </div>
    </div>

    <div>
      <h1 class="text-xl font-semibold">Type Ramp</h1>
      <div class="mt-4 flex flex-col gap-3 rounded border border-outline bg-elevation-1-card p-4">
        {#each Object.entries(tokens.fontSize) as [name, value]}
          <div class="flex items-baseline gap-4">
            <div class="w-16 text-secondary-text">{name}</div>
            <div style:font-size={value}>MQTT message payload preview</div>
            <div class="text-xs text-secondary-text">{value}</div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</Story>
