<script lang="ts">
  import type { Writable } from "svelte/store";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import type { Connection } from "@/stores/connections";
  import ConnectionForm from "@/views/Connection/ConnectionDetailsView/components/ConnectionForm/ConnectionForm.svelte";
  import SubscriptionsForm from "@/views/Connection/ConnectionDetailsView/components/SubscriptionsForm/SubscriptionsForm.svelte";
  import ProtoSection from "@/views/Connection/ConnectionDetailsView/components/ProtoSection/ProtoSection.svelte";

  export let connection: Connection;
  export let isOpen: Writable<boolean>;
</script>

<!--
  Re-hosts the former connection-details page inside a dialog. The forms
  auto-save each valid field change (Felte), so there is no Save/Cancel —
  closing the dialog keeps whatever was entered. Fields disable themselves
  while the connection is connected (handled inside ConnectionForm, which
  also owns the "Connection details" heading + options menu).
-->
<Dialog {isOpen} startEmpty>
  <div class="relative w-[550px] max-w-[78vw] max-h-[78vh] overflow-y-auto p-6">
    <IconButton
      class="absolute right-4 top-4 z-10"
      onClick={() => isOpen.set(false)}
    >
      <Icon type="close" size={16} />
    </IconButton>
    <div class="flex flex-col gap-6">
      <ConnectionForm {connection} />
      <SubscriptionsForm {connection} />
      <ProtoSection {connection} />
    </div>
  </div>
</Dialog>
