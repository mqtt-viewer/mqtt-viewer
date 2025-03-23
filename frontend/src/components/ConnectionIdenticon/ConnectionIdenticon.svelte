<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import { minidenticon } from "minidenticons";
  import { getIdenticonKey } from "./key";

  export let connection: Connection;

  $: svgString = minidenticon(getIdenticonKey(connection));
  $: altText = connection.connectionDetails.name;
</script>

<img
  src={`data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`}
  alt={altText}
/>
