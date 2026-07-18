<script lang="ts">
  import { ChooseCertFile, ChooseDirectory } from "bindings/mqtt-viewer/backend/app/app";
  import Icon from "../Icon/Icon.svelte";
  import Tooltip from "../Tooltip/Tooltip.svelte";
  import Button from "../Button/Button.svelte";
  import BaseInput from "./BaseInput.svelte";
  import envStore from "@/stores/env";

  export let disabled = false;
  export let defaultValue = undefined as string | undefined;
  export let variant: "certificate" | "directory";
  export let actionLabel: string;
  export let valueLabel: string;
  export let value = defaultValue ?? "";
  export let onFileChosen: (filePath: string) => void;
  export let onFileRemoved: () => void;

  // In server mode the native picker returns "" (there is no OS file dialog
  // behind HTTP), so the user types a path that exists inside the container
  // instead. See docs/DOCKER.md for mounting certificates.
  $: isServerMode = $envStore.isServerMode;

  const onManualPathCommit = () => {
    const trimmed = value.trim();
    if (trimmed !== "") {
      onFileChosen(trimmed);
    }
  };

  $: onAddClick = async () => {
    try {
      if (disabled) {
        return;
      }
      let result: string;
      if (variant === "certificate") {
        result = await ChooseCertFile(actionLabel);
      } else {
        result = await ChooseDirectory(actionLabel);
      }
      value = result.slice(1);
      if (result !== undefined) {
        onFileChosen(result);
      }
    } catch (e) {
      throw e;
    }
  };

  const onRemoveClick = () => {
    value = "";
    onFileRemoved();
  };

  // rtl direction is used to show ellipses at start
  // but a bug appends a '/' to the end if the text starts with a '/'
  // so we remove it
  $: valueToDisplay =
    value && value?.charAt(0) === "/" ? value.slice(1) : value;

  let isDivHovered = false;
  const onMouseEnter = () => (isDivHovered = true);
  const onMouseLeave = () => (isDivHovered = false);

  $: hoveredIconColorClass =
    isDivHovered && !disabled ? "text-emphasis" : "text-secondary-text";
  $: iconColorClass =
    !!value && !disabled ? "text-primary" : hoveredIconColorClass;
</script>

{#if isServerMode}
  <div class={`flex flex-col gap-1 w-full ${disabled ? "opacity-60" : ""}`}>
    <div class="flex items-center gap-2 w-full">
      <BaseInput
        name="file-path"
        label={actionLabel}
        placeholder={variant === "certificate" ? "/certs/ca.pem" : "/data"}
        bind:value
        {disabled}
        onChange={() => onManualPathCommit()}
        onBlur={onManualPathCommit}
      />
      {#if value}
        <Button
          {disabled}
          variant="text"
          iconType="closeCircle"
          on:click={onRemoveClick}
        ></Button>
      {/if}
    </div>
    <span class="text-sm text-secondary-text">
      Type a path inside the container. Certificates must be mounted in (see
      docs/DOCKER.md).
    </span>
  </div>
{:else}
  <div class={`flex items-center gap-3 w-full ${disabled ? "opacity-60" : ""}`}>
  <div
    class="flex gap-3 items-center flex-grow min-w-0"
    on:mouseenter={onMouseEnter}
    on:mouseleave={onMouseLeave}
    on:focus={onMouseEnter}
    on:blur={onMouseLeave}
    on:keypress={!!value ? undefined : onAddClick}
    on:click={!!value ? undefined : onAddClick}
    style:cursor={!!value || disabled ? "default" : "pointer"}
  >
    <button
      class={`flex items-center gap-3 h-[28px] transition-colors duration-200 ${iconColorClass}`}
      style:cursor={!!value ? "default" : "pointer"}
      tabindex={!!value ? -1 : undefined}
      {disabled}
    >
      {#if !!value}
        <Icon size={24} type={"tickSquare"} />
      {:else}
        <Icon size={24} type={"plusSquare"} />
      {/if}
      {#if !value}
        <span class="min-w-fit">{actionLabel}</span>
      {/if}
    </button>
    {#if value}
      <span
        class="ml-2 min-w-fit py-[2px] px-3 rounded-full text-sm border-white-text border"
        >{valueLabel}</span
      >
      <Tooltip class="flex flex-grow min-w-0" placement="top">
        <span
          class="truncate flex-grow min-w-0 overflow-hidden"
          style:direction="rtl">{valueToDisplay}</span
        >
        <span slot="tooltip-content">
          {value}
        </span>
      </Tooltip>
    {/if}
  </div>
  {#if value}
    <Button
      {disabled}
      variant="text"
      iconType="closeCircle"
      on:click={onRemoveClick}
    ></Button>
  {/if}
  </div>
{/if}
