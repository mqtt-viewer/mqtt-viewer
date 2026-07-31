<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ProtoSection.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import {
    getStoryArgTypes,
    getStoryArgs,
    mockConnection,
    mockConnectionDetails,
  } from "@/stories/fixtures";
  import type { Connection } from "@/stores/connections";

  const componentName = "ProtoSection";
  const storyId = "Views/Connection/ConnectionDetailsView/ProtoSection";
  const props: string[] = ["connection"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  // Distinct connection ids so each story's proto-import mock state (see
  // mockProtoImportByConnectionId in
  // .storybook/mocks/bindings/mqtt-viewer/backend/app/app.ts) is independent
  // of "Default" (connection id 1, already imported) and of each other.
  const neverImportedConnection: Connection = {
    ...mockConnection,
    connectionState: "connected",
    connectionDetails: {
      ...mockConnectionDetails,
      id: 101,
      name: "Fresh broker",
      protoRegDir: "",
      customIconSeed: "storybook-fresh-broker",
    },
  };

  // Mock connection id 102: pre-seeded in the app.ts mock with a loadError,
  // simulating an import whose .proto files were edited (broken) since the
  // last successful compile.
  const compileErrorConnection: Connection = {
    ...mockConnection,
    connectionState: "connected",
    connectionDetails: {
      ...mockConnectionDetails,
      id: 102,
      name: "Broken protos broker",
      protoRegDir: "/Users/sam/broken-protos",
      customIconSeed: "storybook-broken-protos-broker",
    },
  };

  const { Story } = defineMeta({
    title: "Views/Connection/ConnectionDetailsView/ProtoSection",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } }, // TODO(figma-url)
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story name="Default" args={storyArgs} {template} />

<Story
  name="Never imported"
  args={{ ...storyArgs, connection: neverImportedConnection }}
  {template}
/>

<Story
  name="Compile error"
  args={{ ...storyArgs, connection: compileErrorConnection }}
  {template}
/>

<Story
  name="Upload rejected"
  args={{ ...storyArgs, connection: neverImportedConnection }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // Bypasses the native file-picker dialog: sets the hidden file input's
    // FileList directly and fires the same change event the browser would,
    // uploading a non-.proto file so the mock rejects it the way the real
    // backend's validateProtoUploadName would, surfacing the action-error
    // line.
    const input = canvasElement.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) return;
    const file = new File(["not a proto"], "device.txt", {
      type: "text/plain",
    });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }}
/>
