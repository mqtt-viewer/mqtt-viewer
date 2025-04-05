<script lang="ts">
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import connectionsStore, { type Connection } from "@/stores/connections";
  import subscriptionsStore from "@/stores/subscriptions";
  import Select from "@/components/InputFields/Select.svelte";
  import Button from "@/components/Button/Button.svelte";
  import AddFieldButton from "@/components/Button/AddFieldButton.svelte";

  export let connection: Connection;
  $: connectionId = connection.connectionDetails.id;
  $: subscriptions =
    $subscriptionsStore.subscriptionsByConnectionId[
      connection.connectionDetails.id
    ] ?? [];

  $: onAddSubscriptionClick = async () => {
    try {
      await subscriptionsStore.addSubscription(connectionId);
    } catch (e) {
      console.error(e);
    }
  };

  $: onSubscriptionRemove = async (subId: number) => {
    try {
      if (subscriptions.length === 1) return;
      await subscriptionsStore.deleteSubscription(connectionId, subId);
    } catch (e) {
      console.error(e);
    }
  };

  $: isAllFieldsDisabled = connection.connectionState !== "disconnected";
</script>

<div class="flex flex-col w-[550px]">
  <span class="text-lg mb-4">Subscriptions</span>
</div>
<div class="mt-8 space-y-12 w-full">
  {#each subscriptions as subscription, index}
    <div class="flex gap-3 items-center">
      <div class="w-[12%]">
        <Select
          disabled={isAllFieldsDisabled}
          onChange={(qos) => {
            subscriptionsStore.updateSubscription(connectionId, {
              ...subscription,
              qos: Number(qos),
            });
          }}
          sameWidth
          name={`subscriptions.${index}.qos`}
          defaultValue={subscription.qos}
          label={`QoS`}
          getOptionLabel={(option) => `${option}`}
          options={[0, 1, 2]}
        />
      </div>
      <div class={"flex-grow"}>
        <BaseInput
          disabled={isAllFieldsDisabled}
          onChange={(value) => {
            subscriptionsStore.updateSubscription(connectionId, {
              ...subscription,
              topic: value ?? "",
            });
          }}
          name={`subscriptions.${index}.topic`}
          label="Topic"
          value={subscription.topic}
        />
      </div>
      {#if subscriptions.length !== 1}
        <Button
          disabled={isAllFieldsDisabled}
          variant="text"
          iconType="closeCircle"
          on:click={() => onSubscriptionRemove(subscription.id)}
        />
      {/if}
    </div>
  {/each}
</div>
<AddFieldButton
  disabled={isAllFieldsDisabled}
  class="mt-10"
  text="Add Subscription"
  onClick={onAddSubscriptionClick}
/>
