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
  import { expect, waitFor } from "storybook/test";

  const componentName = "ProtoSection";
  const storyId = "Views/Connection/ConnectionDetailsView/ProtoSection";
  const props: string[] = ["connection", "serverMode"];
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

  const connectionWithId = (
    id: number,
    name: string,
    protoRegDir: string
  ): Connection => ({
    ...mockConnection,
    connectionState: "connected",
    connectionDetails: {
      ...mockConnectionDetails,
      id,
      name,
      protoRegDir,
      customIconSeed: `storybook-proto-${id}`,
    },
  });

  // Mock id 103: imported from a folder; the play uploads a file that fails
  // to compile, and the mock keeps the previous import.
  const keptPreviousConnection = connectionWithId(
    103,
    "Kept previous broker",
    "/Users/sam/certs"
  );
  // Mock ids 104, 105 and 107: never imported, rendered as the web UI.
  const serverModeConnection = connectionWithId(107, "Web UI fresh broker", "");
  const serverModeEmptyFolderConnection = connectionWithId(
    104,
    "Web UI broker",
    ""
  );
  const serverModeFolderConnection = connectionWithId(
    105,
    "Web UI folder broker",
    ""
  );
  // Mock id 108: never imported; the play picks twice while the first pick
  // is still being read.
  const doublePickConnection = connectionWithId(108, "Double pick broker", "");
  // Mock id 106: imported by upload, so there's no folder to re-import from.
  const uploadedConnection = connectionWithId(106, "Uploaded protos broker", "");

  // Bypasses the native picker: sets a hidden file input's FileList directly
  // and fires the change event the browser would. A constructed File has an
  // empty webkitRelativePath, so a folder upload here sends bare names.
  const pickFiles = (input: Element | null, files: File[]) => {
    if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Picks are ignored while the mount compile is busy (as the disabled
  // buttons imply), so a play waits for an import button to enable first.
  const waitUntilIdle = (canvasElement: HTMLElement) =>
    waitFor(() => {
      const button = Array.from(canvasElement.querySelectorAll("button")).find(
        (b) =>
          b.textContent?.includes("Choose .proto folder") ||
          b.textContent?.includes("Replace with files")
      );
      expect(button?.disabled).toBe(false);
    });

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
    await waitUntilIdle(canvasElement);
    const input = canvasElement.querySelector(
      'input[data-testid="proto-files-input"]'
    );
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

<!-- Imported from a folder, so Re-import shows beside the replace actions. -->
<Story
  name="Import failed, kept previous"
  args={{ ...storyArgs, connection: keptPreviousConnection }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitUntilIdle(canvasElement);
    pickFiles(canvasElement.querySelector('input[data-testid="proto-files-input"]'), [
      new File(['import "common/units.proto"; BROKEN'], "telemetry.proto"),
    ]);
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Import failed, so I kept the previous files."
      )
    );
  }}
/>

<Story
  name="Imported from upload"
  args={{ ...storyArgs, connection: uploadedConnection }}
  {template}
/>

<Story
  name="Server mode"
  args={{ ...storyArgs, connection: serverModeConnection, serverMode: true }}
  {template}
/>

<Story
  name="Server mode, folder without protos"
  args={{
    ...storyArgs,
    connection: serverModeEmptyFolderConnection,
    serverMode: true,
  }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitUntilIdle(canvasElement);
    pickFiles(
      canvasElement.querySelector('input[data-testid="proto-folder-input"]'),
      [new File(["# notes"], "README.md", { type: "text/markdown" })]
    );
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "That folder has no .proto files."
      )
    );
  }}
/>

<Story
  name="Server mode, folder imported"
  args={{
    ...storyArgs,
    connection: serverModeFolderConnection,
    serverMode: true,
  }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitUntilIdle(canvasElement);
    pickFiles(
      canvasElement.querySelector('input[data-testid="proto-folder-input"]'),
      [
        new File(['syntax = "proto3";'], "telemetry.proto"),
        new File(["# notes"], "README.md", { type: "text/markdown" }),
      ]
    );
    await waitFor(() =>
      expect(canvasElement.textContent).toContain("Replace with folder")
    );
  }}
/>

<!-- A second pick while the first is still being read is ignored: only the
     first (good) upload imports, so the broken second one never runs. -->
<Story
  name="Second pick while reading"
  args={{ ...storyArgs, connection: doublePickConnection }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitUntilIdle(canvasElement);
    const input = canvasElement.querySelector('input[data-testid="proto-files-input"]');
    pickFiles(input, [new File(['syntax = "proto3";'], "telemetry.proto")]);
    pickFiles(input, [new File(["BROKEN"], "telemetry.proto")]);
    await waitFor(() =>
      expect(canvasElement.textContent).toContain("Replace with files")
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(canvasElement.textContent).not.toContain("Import failed");
  }}
/>
