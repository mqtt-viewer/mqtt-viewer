<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./UpdateAvailableContent.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { UpdateResponse } from "bindings/mqtt-viewer/backend/update/models";
  import type { ChangelogEntry } from "@/changelog";
  import { REPO_URL, renderReleaseNotes } from "@/release-notes";

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

  // The real thing: what `just release` puts on the GitHub release, which the
  // workflows post to the portal and this dialog then renders. Rendered here
  // from a changelog entry shaped like a real one, so the story shows the
  // notes a user will actually read.
  const longEntry: ChangelogEntry = {
    version: "1.2.0",
    released: true,
    date: "September 2026",
    headline: "Charts, broker status, and a much calmer topic tree",
    intro:
      "Here's what's landed since 1.1.0. Nothing to do on your side, it all comes with the update.",
    sections: [
      {
        title: "Chart your data, live",
        body: "Tick a numeric field on a topic and it plots straight away, with the time window of your choice.",
        thanks: [
          {
            name: "edolis",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/43",
          },
        ],
      },
      {
        title: "A status page for your broker",
        body: "The pulse icon above the topic tree opens a window showing connected clients, message and byte rates, subscriptions, retained messages and uptime.",
        thanks: [
          {
            name: "m1dnight",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/1",
          },
          {
            name: "Daschi2",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/discussions/84",
          },
        ],
      },
      {
        title: "Peek at messages on the timeline",
        body: "Hovering a marker on the message timeline shows a preview with the payload, time, QoS and whether it was retained.",
      },
      {
        title: "Steadier under heavy load",
        body: "The topic tree and history stay smooth on brokers pushing thousands of messages a second.",
      },
      {
        title: "A proper Save button for connections",
        body: "The connection dialog has a footer with a Save button and a note showing when your changes were last saved.",
        thanks: [
          {
            name: "jeeftor",
            url: "https://github.com/mqtt-viewer/mqtt-viewer/issues/124",
          },
        ],
      },
      {
        title: "Dropdowns inside dialogs work again",
        body: "Version and Protocol opened invisibly behind the connection dialog, so clicking them appeared to do nothing.",
      },
      {
        title: "Linux packaging",
        body: "There are deb, rpm and Flatpak builds now, and the Flatpak repository updates in place.",
      },
      {
        title: "A tidier sidebar and forms",
        body: "Rows, icons and hover highlights line up on a shared grid, and form fields breathe properly instead of crowding their labels.",
      },
    ],
    outro: "Found a bug or a rough edge? Use the Feedback button, I want to know.",
  };

  const longReleaseNotes = renderReleaseNotes(longEntry, {
    tag: "v1.2.0",
    prevTag: "v1.1.0",
    repoUrl: REPO_URL,
  });

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
