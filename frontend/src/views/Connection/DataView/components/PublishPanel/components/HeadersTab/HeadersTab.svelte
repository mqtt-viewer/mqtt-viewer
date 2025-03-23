<script lang="ts">
  import { type PublishHeaderValues } from "./validation";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import HeaderRow from "./components/HeaderRow.svelte";
  import { writable } from "svelte/store";
  import Switch from "@/components/InputFields/Switch.svelte";
  import BaseNumberInput from "@/components/InputFields/BaseNumberInput.svelte";

  export let data: PublishHeaderValues;
  let payloadFormatChecked = writable(false);
  $: data.payloadFormatIndicator,
    (() => {
      if (data.payloadFormatIndicator !== $payloadFormatChecked) {
        payloadFormatChecked.set(data.payloadFormatIndicator);
      }
    })();
</script>

<div class="space-y-3">
  <HeaderRow>
    <span slot="key">Content Type</span>
    <BaseInput name="contentType" bind:value={data.contentType} />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Payload Format Indicator</span>
    <Switch
      name="payloadFormatIndicator"
      bind:checked={payloadFormatChecked}
      bind:checkedBool={data.payloadFormatIndicator}
      label={$payloadFormatChecked ? "On" : "Off"}
    />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Message Expiry Interval</span>
    <BaseNumberInput
      bind:value={data.messageExpiryInterval}
      name="messageExpiryInterval"
    />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Topic Alias</span>
    <BaseNumberInput bind:value={data.topicAlias} name="topicAlias" />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Response Topic</span>
    <BaseInput bind:value={data.responseTopic} name="responseTopic" />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Correlation Data</span>
    <BaseInput bind:value={data.correlationData} name="correlationData" />
  </HeaderRow>
  <HeaderRow>
    <span slot="key">Subscription Identifier</span>
    <BaseNumberInput
      bind:value={data.subscriptionIdentifier}
      name="subscriptionIdentifier"
    />
  </HeaderRow>
</div>
