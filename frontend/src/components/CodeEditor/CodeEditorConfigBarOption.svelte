<script lang="ts" generics="OptionType">
  import { writable } from "svelte/store";
  import { createSelect, melt, type SelectOption } from "@melt-ui/svelte";
  import { fade } from "svelte/transition";
  import IconButton from "../Button/IconButton.svelte";

  let className = "";
  export { className as class };
  export let name: string;
  export let options: OptionType[] = [];
  export let defaultValue = undefined as OptionType | undefined;
  export let getOptionLabel: (option?: OptionType) => string;
  export let getOptionDisplay: (option?: OptionType) => string = getOptionLabel;
  export let selected = writable<SelectOption<OptionType | undefined>>(
    defaultValue !== undefined
      ? { value: defaultValue, label: getOptionLabel(defaultValue) }
      : undefined
  );
  export let onChange = (value: OptionType | undefined) => {};
  export let setValue = (value: OptionType | undefined) => {
    selected.set({
      value,
      label: getOptionLabel(value),
    });
  };
  const {
    elements: {
      trigger,
      menu,
      option,
      group,
      groupLabel,
      label: meltLabel,
      hiddenInput,
    },
    options: { disabled: disabledStore },
    states: { selectedLabel, open },
    helpers: { isSelected },
  } = createSelect({
    name,
    forceVisible: true,
    selected,
    positioning: {
      placement: "bottom-start",
      fitViewport: true,
    },
    onSelectedChange: ({ curr, next }) => {
      if (onChange !== null) {
        onChange(next?.value);
      }
      return next;
    },
  });
</script>

<input use:melt={$hiddenInput} />
<button use:melt={$trigger} class={className}
  ><IconButton class="text">{getOptionDisplay($selected.value)}</IconButton
  ></button
>
{#if $open}
  <div
    class="z-10 flex max-h-[300px] flex-col
        overflow-y-auto rounded bg-elevation-2 p-1
        shadow focus:!ring-0"
    use:melt={$menu}
    transition:fade={{ duration: 150 }}
  >
    {#each options as item}
      <div
        class="relative cursor-pointer rounded py-1 px-2 text-white-text focus:z-10
              data-[highlighted]:bg-elevation-2-hover data-[highlighted]:text-white
              data-[selected]:border-primary data-[selected]:border-[1px]"
        use:melt={$option({ value: item, label: getOptionLabel(item) })}
      >
        {getOptionLabel(item)}
      </div>
    {/each}
  </div>
{/if}
