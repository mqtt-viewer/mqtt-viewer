<script lang="ts">
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "../Icon/Icon.svelte";
  import { copyToClipboard } from "@/util/copy";

  export let text = "";
  export let size = 16;
  export let tooltipText = undefined as string | undefined;
  let className = "";
  export { className as class };
</script>

<IconButton
  class={className}
  tooltipText={tooltipText ?? "Copy"}
  feedbackText="Copied"
  tooltipOpenDelay={500}
  onClick={() => copyToClipboard(text)}
>
  <span slot="icon">
    <Icon type="copy" {size} />
  </span>
  <span slot="feedback-icon">
    <Icon type="tick" {size} />
  </span>
</IconButton>
