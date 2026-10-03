<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import Component from "./ProtoBindingRulesForm.svelte";
  import StoryRender from "@/stories/StoryRender.svelte";
  import { getStoryArgTypes, getStoryArgs } from "@/stories/fixtures";
  import { expect, userEvent, waitFor, within } from "storybook/test";

  const componentName = "ProtoBindingRulesForm";
  const storyId = "Components/ProtoBindingRulesForm";
  const props: string[] = [
    "rules",
    "descriptorNames",
    "status",
    "disabled",
    "connected",
    "onAdd",
    "onUpdate",
    "onDelete",
    "onMove",
    "onTestTopic",
  ];
  const storyArgs = getStoryArgs(storyId, componentName, props);

  const noop = (...args: unknown[]) => {};
  const noStatus = {
    loadError: "",
    dirMissing: true,
    folderNotFound: false,
  };
  const okStatus = {
    loadError: "",
    dirMissing: false,
    folderNotFound: false,
  };
  const errorStatus = {
    loadError: "line 12: unexpected token '}'",
    dirMissing: false,
    folderNotFound: false,
  };

  const mockDescriptorNames = [
    "acme.Envelope",
    "acme.Envelope.Inner",
    "org.eclipse.tahu.protobuf.Payload",
  ];

  const mockRules = [
    {
      id: 1,
      topicFilter: "sensors/+/telemetry",
      messageType: "acme.Envelope",
    },
    { id: 2, topicFilter: "sensors/#", messageType: "acme.Envelope.Inner" },
  ];

  const staleRules = [
    { id: 1, topicFilter: "sensors/+/telemetry", messageType: "acme.Retired" },
  ];

  const mockTestResult = {
    filter: "sensors/+/telemetry",
    messageType: "acme.Envelope",
    source: "rule" as const,
  };

  const baseArgs = {
    ...storyArgs,
    descriptorNames: mockDescriptorNames,
    onAdd: noop,
    onUpdate: noop,
    onDelete: noop,
    onMove: noop,
    onTestTopic: async () => mockTestResult,
  };

  const rejectWrite = async () => {
    throw new Error("database is locked");
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  type RuleChanges = { topicFilter?: string; messageType?: string };

  // Records every onUpdate call; each play resets it first.
  let updateCalls: RuleChanges[] = [];

  // Slower than the 400ms debounce, so a blur lands mid-write.
  const slowUpdate = async (_id: number, changes: RuleChanges) => {
    updateCalls.push(changes);
    await sleep(500);
  };

  // A filter-only save fails; anything else succeeds.
  const failFilterOnlyUpdate = async (_id: number, changes: RuleChanges) => {
    updateCalls.push(changes);
    if (changes.messageType === undefined) throw new Error("database is locked");
  };

  let addCalls = 0;
  const rejectAdd = async () => {
    addCalls++;
    throw new Error("database is locked");
  };

  const rowInput = (canvasElement: HTMLElement, id: number | "draft") => {
    const input = canvasElement.querySelector(
      `input[name="proto-binding-filter-${id}"]`
    );
    if (!(input instanceof HTMLInputElement)) throw new Error("row input not found");
    return input;
  };

  const typeInto = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const { Story } = defineMeta({
    title: "Components/ProtoBindingRulesForm",
    component: Component,
    tags: ["autodocs"],
    argTypes: getStoryArgTypes(componentName, props) as any,
    parameters: { design: { type: "figma", url: "" } }, // TODO(figma-url)
  });
</script>

{#snippet template(args: any)}
  <div class="w-[502px]">
    <StoryRender component={Component} {args} {componentName} />
  </div>
{/snippet}

<Story
  name="EmptyNoDir"
  args={{ ...baseArgs, rules: [], descriptorNames: [], status: noStatus }}
  {template}
/>
<Story
  name="RulesPopulated"
  args={{ ...baseArgs, rules: mockRules, status: okStatus }}
  {template}
/>
<Story
  name="CompileError"
  args={{ ...baseArgs, rules: mockRules, descriptorNames: [], status: errorStatus }}
  {template}
/>
<Story
  name="StaleType"
  args={{ ...baseArgs, rules: staleRules, status: okStatus }}
  {template}
/>
<Story
  name="ConnectedLive"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, connected: true }}
  {template}
/>
<Story
  name="Disabled"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, disabled: true }}
  {template}
/>
<!-- A failed filter save: the typed text stays (the row stays dirty, so the
     next edit or blur retries) and the error shows on the row. -->
<Story
  name="RowSaveError"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, onUpdate: rejectWrite }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const input = canvasElement.querySelector(
      'input[name="proto-binding-filter-1"]'
    );
    if (!(input instanceof HTMLInputElement)) throw new Error("row input not found");
    input.value = "sensors/+/status";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur"));
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Could not save: database is locked"
      )
    );
    expect(input.value).toBe("sensors/+/status");
  }}
/>
<Story
  name="DeleteError"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, onDelete: rejectWrite }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const button = canvasElement.querySelector(
      'button[aria-label="Delete binding"]'
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("delete button not found");
    button.click();
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Could not delete that binding: database is locked"
      )
    );
  }}
/>
<!-- The debounce fires a filter write; the blur that follows while it's in
     flight must not send the same update again. -->
<Story
  name="RowBlurDuringWrite"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, onUpdate: slowUpdate }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    updateCalls = [];
    const input = rowInput(canvasElement, 1);
    typeInto(input, "sensors/+/status");
    await sleep(450);
    input.dispatchEvent(new Event("blur"));
    await sleep(600);
    expect(updateCalls).toEqual([{ topicFilter: "sensors/+/status" }]);
  }}
/>
<!-- A failed filter save, then a type pick on the same row: the pick saves
     the unsaved filter with it, so the error only clears once the text has
     actually saved. -->
<Story
  name="TypePickAfterFilterSaveError"
  args={{
    ...baseArgs,
    rules: mockRules,
    status: okStatus,
    onUpdate: failFilterOnlyUpdate,
  }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    updateCalls = [];
    const input = rowInput(canvasElement, 1);
    typeInto(input, "sensors/+/status");
    input.dispatchEvent(new Event("blur"));
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Could not save: database is locked"
      )
    );
    const triggers = canvasElement.querySelectorAll("button.trigger");
    await userEvent.click(triggers[0] as HTMLElement);
    const option = await within(document.body).findByRole("menuitem", {
      name: "acme.Envelope.Inner",
    });
    await userEvent.click(option);
    await waitFor(() =>
      expect(updateCalls[1]).toEqual({
        messageType: "acme.Envelope.Inner",
        topicFilter: "sensors/+/status",
      })
    );
    await waitFor(() =>
      expect(canvasElement.textContent).not.toContain("Could not save")
    );
  }}
/>
<!-- After a failed add, Cancel discards the draft without retrying it. -->
<Story
  name="CancelAfterAddError"
  args={{ ...baseArgs, rules: mockRules, status: okStatus, onAdd: rejectAdd }}
  {template}
  play={async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    addCalls = 0;
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Add binding"));
    const input = await waitFor(() => rowInput(canvasElement, "draft"));
    await userEvent.type(input, "plant/#");
    const triggers = canvasElement.querySelectorAll("button.trigger");
    await userEvent.click(triggers[triggers.length - 1] as HTMLElement);
    const option = await within(document.body).findByRole("menuitem", {
      name: "acme.Envelope",
    });
    await userEvent.click(option);
    await waitFor(() =>
      expect(canvasElement.textContent).toContain(
        "Could not add the binding: database is locked"
      )
    );
    expect(addCalls).toBe(1);
    await userEvent.click(input);
    await userEvent.click(canvas.getByLabelText("Cancel"));
    await waitFor(() =>
      expect(canvasElement.querySelector('input[name="proto-binding-filter-draft"]')).toBeNull()
    );
    expect(addCalls).toBe(1);
  }}
/>
