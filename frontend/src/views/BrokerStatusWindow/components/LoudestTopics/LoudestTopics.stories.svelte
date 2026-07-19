<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./LoudestTopics.svelte";
  import { mockLoudest } from "@/stories/fixtures";

  const collecting = () => ({ ...mockLoudest(), collecting: true });
  const noOverflow = () => ({
    ...mockLoudest(),
    overflowTopics: 0,
    overflowMsgPerSec: 0,
  });
  const empty = () => ({
    rows: [],
    overflowTopics: 0,
    overflowMsgPerSec: 0,
    collecting: true,
  });

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/LoudestTopics",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <div class="w-[640px] max-w-full bg-elevation-0 p-4">
    <Component {...args} />
  </div>
{/snippet}

{#snippet narrow(args: any)}
  <div class="w-[300px] bg-elevation-0 p-4">
    <Component {...args} />
  </div>
{/snippet}

<Story name="Populated" args={{ loudest: mockLoudest() }} {template} />
<Story name="Collecting" args={{ loudest: collecting() }} {template} />
<Story name="NoOverflow" args={{ loudest: noOverflow() }} {template} />
<Story name="Narrow" args={{ loudest: mockLoudest() }} template={narrow} />
<Story name="Empty" args={{ loudest: empty() }} {template} />
