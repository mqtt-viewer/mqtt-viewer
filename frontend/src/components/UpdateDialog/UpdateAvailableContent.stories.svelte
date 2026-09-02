<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./UpdateAvailableContent.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { UpdateResponse } from "bindings/mqtt-viewer/backend/update/models";

  const componentName = "UpdateAvailableContent";
  const storyId = "Components/UpdateDialog/UpdateAvailableContent";
  const props: string[] = ["update", "currentVersion"];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const releaseNotes = [
    "## v1.1.0",
    "",
    "- Chart view for numeric payloads",
    "- Faster topic tree under sustained load",
    "- Fixed reconnect loop on broker restart",
  ].join("\n");

  const longUrl =
    "https://portal.mqttviewer.app/releases/download/v1.2.0/mqttviewer_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.AppImage";

  const longReleaseNotes = [
    "## v1.2.0",
    "",
    ...Array.from(
      { length: 30 },
      (_, i) => `- Change number ${i + 1} in a fairly long changelog`
    ),
    "",
    `Full artifact: ${longUrl}`,
  ].join("\n");

  const { Story } = defineMeta({
    title: "Components/UpdateDialog/UpdateAvailableContent",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

{#snippet template(args: any)}
  <StoryRender component={Component} {args} {componentName} />
{/snippet}

<Story
  name="SelfUpdate"
  args={{
    ...storyArgs,
    update: new UpdateResponse({
      latest_version: "v1.1.0",
      can_self_update: true,
      release_notes: releaseNotes,
      install_type: "",
      update_command: "",
      instructions: "",
      releases_url: "",
    }),
    currentVersion: "v1.0.0",
  }}
  {template}
/>

<Story
  name="PackageManaged"
  args={{
    ...storyArgs,
    update: new UpdateResponse({
      latest_version: "v1.1.0",
      can_self_update: false,
      release_notes: "- Chart view for numeric payloads",
      install_type: "nix",
      update_command: "nix profile upgrade mqtt-viewer",
      instructions:
        "This install is managed by Nix. Update it from your shell:",
      releases_url: "",
    }),
    currentVersion: "v1.0.0",
  }}
  {template}
/>

<Story
  name="LongNotes"
  args={{
    ...storyArgs,
    update: new UpdateResponse({
      latest_version: "v1.2.0",
      can_self_update: true,
      release_notes: longReleaseNotes,
      install_type: "",
      update_command: "",
      instructions: "",
      releases_url: "",
    }),
    currentVersion: "v1.0.0",
  }}
  {template}
/>
