<script lang="ts">
  import AddFieldButton from "@/components/Button/AddFieldButton.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";

  export let userProperties: { key: string; value: string }[];

  $: addUserPropertyInput = () => {
    userProperties = [...userProperties, { key: "", value: "" }];
  };

  $: deleteUserPropertyInput = (index: number) => {
    if (userProperties.length === 1) {
      userProperties = [{ key: "", value: "" }];
      return;
    }
    const newData = [...userProperties];
    newData.splice(index, 1);
    userProperties = newData;
  };
</script>

<div class="flex flex-col gap-4 max-h-full overflow-auto">
  {#each userProperties as _, index}
    <div class="flex w-full items-center gap-2">
      <BaseInput
        name={`key${index}`}
        placeholder="Property"
        class="flex-grow"
        bind:value={userProperties[index].key}
      />
      <BaseInput
        name={`value${index}`}
        placeholder="Value"
        class="flex-grow"
        bind:value={userProperties[index].value}
      />
      <Button
        variant="text"
        iconType="close"
        iconSize={16}
        on:click={() => deleteUserPropertyInput(index)}
      />
    </div>
  {/each}
  <AddFieldButton
    text="Add User Property"
    onClick={addUserPropertyInput}
    size="small"
  />
</div>
