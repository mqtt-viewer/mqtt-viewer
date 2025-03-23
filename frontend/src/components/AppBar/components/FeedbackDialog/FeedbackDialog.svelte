<script lang="ts">
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import { writable } from "svelte/store";
  import GiveFeedbackCard from "./GiveFeedbackCard.svelte";
  import { BrowserOpenURL } from "wailsjs/runtime/runtime";
  import Button from "@/components/Button/Button.svelte";

  export let open = writable(false);

  const onClose = () => {
    open.set(false);
  };

  const onSubmitFeatureClick = async () => {
    BrowserOpenURL("https://mqtt-viewer.canny.io/feature-requests");
    onClose();
  };

  const onSubmitBugClick = async () => {
    BrowserOpenURL("https://mqtt-viewer.canny.io/feature-requests");
  };

  const onJoinSlackChannelClick = () => {
    BrowserOpenURL(
      "https://join.slack.com/t/mqttviewercommunity/shared_invite/zt-2rkuhktty-xmHqWeNzKGWPQTJve491uA"
    );
  };
</script>

<Dialog title="Help make MQTT Viewer better" {onClose} isOpen={open}>
  <div class="flex flex-col gap-3 mt-3 w-[400px]">
    <div class="flex w-full gap-4">
      <div class="w-1/2">
        <GiveFeedbackCard
          icon="feature"
          iconClass="text-success"
          title="I have an idea"
          text="Have a feature idea or suggestion?"
          onClick={onSubmitFeatureClick}
        />
      </div>
      <div class="w-1/2">
        <GiveFeedbackCard
          icon="bug"
          iconClass="text-error"
          title="Something's broken"
          text="Found a bug or something not working as expected?"
          onClick={onSubmitBugClick}
        />
      </div>
    </div>

    <div
      class="w-full text-secondary-text flex flex-col gap-2 items-center mt-3"
    >
      <p class="">
        You can also join the <span class="inline-block"
          ><Button
            variant="text"
            class="underline underline-offset-2"
            on:click={onJoinSlackChannelClick}
            >MQTT Viewer Slack community</Button
          ></span
        >
      </p>
    </div>
  </div>
</Dialog>
