<script lang="ts">
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "../Icon/Icon.svelte";
  import { copyToClipboard } from "@/util/copy";
  import { errorMessage } from "@/util/strings";
  import { addToast } from "../Toast/Toast.svelte";

  export let text = "";
  export let size = 16;
  export let tooltipText = undefined as string | undefined;
  let className = "";
  export { className as class };

  const onCopy = async () => {
    try {
      await copyToClipboard(text);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to copy",
          description: errorMessage(e),
          type: "error",
        },
      });
    }
  };
</script>

<IconButton
  class={className}
  tooltipText={tooltipText ?? "Copy"}
  feedbackText="Copied"
  tooltipOpenDelay={500}
  onClick={onCopy}
>
  <span slot="icon">
    <Icon type="copy" {size} />
  </span>
  <span slot="feedback-icon">
    <Icon type="tick" {size} />
  </span>
</IconButton>
