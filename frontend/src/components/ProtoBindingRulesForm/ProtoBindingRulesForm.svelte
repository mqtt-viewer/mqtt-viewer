<script context="module" lang="ts">
  export interface ProtoBindingRuleView {
    id: number;
    topicFilter: string;
    messageType: string;
  }

  // loadError/dirMissing/folderNotFound mirror the section's own status line
  // (rendered above this component by the container). dirMissing (no dir
  // configured) picks between the two empty states below; folderNotFound
  // (dir configured but not found on disk) and loadError together suppress
  // the stale-type warning on rows, since neither case means the type is
  // actually stale.
  export interface ProtoBindingStatusView {
    loadError: string;
    dirMissing: boolean;
    folderNotFound: boolean;
  }

  export interface ProtoBindingMatchView {
    filter: string;
    messageType: string;
    source: "rule" | "sparkplug";
  }
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { debounce } from "lodash";
  import type { DebouncedFunc } from "lodash";
  import { twMerge } from "tailwind-merge";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Button from "@/components/Button/Button.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import AddFieldButton from "@/components/Button/AddFieldButton.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { validateTopicFilter } from "@/util/topic-filter";

  export let rules: ProtoBindingRuleView[] = [];
  export let descriptorNames: string[] = [];
  export let status: ProtoBindingStatusView = {
    loadError: "",
    dirMissing: true,
    folderNotFound: false,
  };
  export let disabled = false;
  export let connected = false;
  export let onAdd: (rule: {
    topicFilter: string;
    messageType: string;
  }) => void | Promise<void> = () => {};
  export let onUpdate: (
    id: number,
    changes: Partial<Pick<ProtoBindingRuleView, "topicFilter" | "messageType">>
  ) => void = () => {};
  export let onDelete: (id: number) => void = () => {};
  export let onMove: (id: number, direction: "up" | "down") => void = () => {};
  export let onTestTopic: (
    topic: string
  ) => Promise<ProtoBindingMatchView | null> = async () => null;

  $: showReorder = rules.length >= 2;

  // Exact-duplicate topic filters: the first occurrence in list order wins
  // ties (matches ProtoBindingMatcher's SortOrder tie-break), so only the
  // later duplicates are flagged. Deliberately based on the committed
  // `rules` list (not live edit-state text) to avoid flicker across rows
  // mid-edit.
  $: duplicateFlags = (() => {
    const seen = new Set<string>();
    return rules.map((rule) => {
      const isDuplicate = seen.has(rule.topicFilter);
      seen.add(rule.topicFilter);
      return isDuplicate;
    });
  })();

  // Local optimistic edit state for each row's topic-filter input, keyed by
  // rule id. Typing updates this map immediately (so the field feels live
  // and validation renders as-you-type); the backend write is debounced and
  // only fires once the value validates. `dirty` tracks whether the user has
  // an in-progress edit that hasn't round-tripped yet, so an incoming
  // `rules` refresh (from this row's own commit landing, another window's
  // edit, or the periodic ProtoStateChanged poll) never clobbers text the
  // user is actively typing or that's sitting there invalid waiting to be
  // fixed.
  let editStateByRuleId: Record<number, { value: string; dirty: boolean }> =
    {};

  const syncEditState = (rules: ProtoBindingRuleView[]) => {
    const next: Record<number, { value: string; dirty: boolean }> = {};
    for (const rule of rules) {
      const existing = editStateByRuleId[rule.id];
      if (!existing) {
        next[rule.id] = { value: rule.topicFilter, dirty: false };
      } else if (!existing.dirty) {
        next[rule.id] = { value: rule.topicFilter, dirty: false };
      } else {
        next[rule.id] = existing;
      }
    }
    editStateByRuleId = next;
  };

  $: syncEditState(rules);

  const rowFilterValue = (rule: ProtoBindingRuleView) =>
    editStateByRuleId[rule.id]?.value ?? rule.topicFilter;

  const rowError = (rule: ProtoBindingRuleView, index: number) => {
    const validationError = validateTopicFilter(rowFilterValue(rule));
    if (validationError) return validationError;
    if (duplicateFlags[index]) {
      return "Same filter as another binding. The higher one wins.";
    }
    return null;
  };

  const isStaleType = (messageType: string) =>
    !!messageType &&
    !descriptorNames.includes(messageType) &&
    !status.loadError &&
    !status.folderNotFound;

  // Commits a real row's locally-edited topic filter, if it's valid and
  // different from the last-known committed value. No-ops while invalid
  // (leaves text/error/dirty as-is) so the user can keep fixing it.
  const commitRowEdit = (rule: ProtoBindingRuleView) => {
    const entry = editStateByRuleId[rule.id];
    if (!entry) return;
    const localValue = entry.value;
    if (validateTopicFilter(localValue)) return;
    if (localValue !== rule.topicFilter) {
      onUpdate(rule.id, { topicFilter: localValue });
    }
    editStateByRuleId = {
      ...editStateByRuleId,
      [rule.id]: { value: localValue, dirty: false },
    };
  };

  // Debounced commit, one per rule id. The callback looks up the current
  // rule from `rules` by id *at fire time* rather than closing over the
  // `rule` object passed in when the debounced function was first created:
  // the debounce instance is cached and reused across every keystroke for
  // that row, so a stale closure would keep comparing against the rule's
  // topicFilter as it was on the very first keystroke. That made an
  // A -> B -> A edit silently drop the second edit, since B -> A looked
  // like a no-op against the stale "A" snapshot.
  const debouncedCommitByRuleId: Record<number, DebouncedFunc<() => void>> =
    {};
  const debouncedCommitFor = (ruleId: number) => {
    if (!debouncedCommitByRuleId[ruleId]) {
      debouncedCommitByRuleId[ruleId] = debounce(() => {
        const currentRule = rules.find((r) => r.id === ruleId);
        if (currentRule) commitRowEdit(currentRule);
      }, 400);
    }
    return debouncedCommitByRuleId[ruleId];
  };

  const onRowFilterChange = (rule: ProtoBindingRuleView, value: string) => {
    editStateByRuleId = {
      ...editStateByRuleId,
      [rule.id]: { value, dirty: true },
    };
    debouncedCommitFor(rule.id)();
  };

  const onRowFilterBlur = (rule: ProtoBindingRuleView) => {
    debouncedCommitByRuleId[rule.id]?.cancel();
    commitRowEdit(rule);
  };

  onDestroy(() => {
    // Flush, not cancel: closing the dialog (which destroys this component)
    // should persist a just-typed valid edit sitting in the debounce window
    // rather than drop it.
    Object.values(debouncedCommitByRuleId).forEach((fn) => fn.flush());
  });

  // Per-row type-picker search text, keyed by rule id. The draft row (no
  // rule id yet) uses the "draft" sentinel key.
  let typeSearchByRuleId: Partial<Record<number | "draft", string>> = {};

  const filteredTypes = (key: number | "draft") => {
    const query = (typeSearchByRuleId[key] ?? "").trim().toLowerCase();
    if (!query) return descriptorNames;
    return descriptorNames.filter((name) => name.toLowerCase().includes(query));
  };

  // Draft row: "Add binding" opens this instead of writing to the backend
  // immediately. Unlike the real rows above, the draft never auto-commits
  // while typing: a typeless binding does nothing, so committing on every
  // keystroke would just spam the backend with rules the user hasn't
  // finished setting up. It commits only on blur, Enter, or picking a type,
  // and only once the filter validates and a type is chosen.
  let draft: { topicFilter: string; messageType: string } | null = null;
  let draftSubmitting = false;
  // First keystroke or blur, gates the error/red-border state so clicking
  // "Add binding" doesn't immediately show "Enter a topic filter" before
  // the user has typed anything.
  let draftTouched = false;
  let draftInputEl: HTMLInputElement | undefined = undefined;

  const onAddClicked = async () => {
    if (draft !== null) return;
    draft = { topicFilter: "", messageType: "" };
    draftTouched = false;
    await tick();
    draftInputEl?.focus();
  };

  const commitDraft = async () => {
    if (!draft || draftSubmitting) return;
    if (validateTopicFilter(draft.topicFilter)) return;
    // A typeless binding does nothing (the middleware treats it as no
    // match), so don't create one.
    if (!draft.messageType) return;
    draftSubmitting = true;
    try {
      await onAdd({ ...draft });
      draft = null;
      draftSubmitting = false;
      draftTouched = false;
    } catch (e) {
      console.error(e);
      draftSubmitting = false;
    }
  };

  // BaseInput doesn't forward `on:keydown` to its inner <input>, so Enter is
  // wired directly on the bound element instead.
  $: if (draftInputEl) {
    draftInputEl.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        draftTouched = true;
        commitDraft();
      }
    };
  }

  const onDraftFilterChange = (value: string) => {
    if (!draft) return;
    draftTouched = true;
    draft = { ...draft, topicFilter: value };
  };

  const onDraftFilterBlur = () => {
    draftTouched = true;
    commitDraft();
  };

  const onDraftTypePicked = (name: string) => {
    if (!draft) return;
    draft = { ...draft, messageType: name };
    commitDraft();
  };

  const onDraftCancel = () => {
    draft = null;
    draftTouched = false;
  };

  let testTopic = "";
  let testResult: ProtoBindingMatchView | null | undefined = undefined;
  let testError = false;
  // Guards against an earlier, slower request's result landing after a
  // later one's and clobbering it: only the response matching the most
  // recently issued request is ever assigned.
  let testRequestToken = 0;

  const runTest = async (topic: string) => {
    const token = ++testRequestToken;
    if (!topic) {
      testResult = undefined;
      testError = false;
      return;
    }
    try {
      const result = await onTestTopic(topic);
      if (token !== testRequestToken) return;
      testResult = result;
      testError = false;
    } catch (e) {
      if (token !== testRequestToken) return;
      console.error(e);
      testError = true;
    }
  };

  const debouncedRunTest = debounce(runTest, 400);
  onDestroy(() => debouncedRunTest.cancel());

  // Re-runs the tester whenever the bindings list or the loaded types change
  // (not just when the topic text changes), so a rule edit or a registry
  // reload updates the tester's result without the user retyping the topic.
  $: rules, descriptorNames, debouncedRunTest(testTopic);
</script>

{#snippet typePicker(
  key: number | "draft",
  value: string,
  onPick: (name: string) => void
)}
  <DropdownMenu {disabled} placement="bottom-end">
    <div
      slot="trigger"
      class={twMerge(
        "h-[30px] w-[180px] flex items-center justify-between gap-1 rounded border border-outline px-2 text-base bg-elevation-0 transition-colors",
        disabled ? "opacity-60" : "cursor-pointer hover:border-hovered",
        value ? "text-white-text" : "text-secondary-text"
      )}
    >
      <span class="truncate min-w-0" style:direction="rtl"
        ><bdi>{value || "Choose a type"}</bdi></span
      >
      <Icon type="down" size={12} />
    </div>
    <div class="flex flex-col min-w-[220px]" slot="menu-content">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="bg-transparent outline-none border-b border-divider px-2 pb-2 pt-1 mb-1 text-base text-white-text placeholder:text-secondary-text"
        autofocus
        placeholder="Filter types..."
        bind:value={typeSearchByRuleId[key]}
        on:keydown|stopPropagation={() => {}}
      />
      <div class="flex flex-col max-h-[320px] overflow-y-auto">
        {#each filteredTypes(key) as name (name)}
          <DropdownMenuItem
            onClick={() => {
              onPick(name);
              typeSearchByRuleId = { ...typeSearchByRuleId, [key]: "" };
            }}
          >
            <div class="flex items-center gap-2 w-full">
              <span class="truncate grow">{name}</span>
              {#if name === value}
                <Icon type="tick" size={14} />
              {/if}
            </div>
          </DropdownMenuItem>
        {/each}
        {#if descriptorNames.length === 0}
          <div class="px-2 py-1 text-base text-secondary-text">
            No types loaded
          </div>
        {:else if filteredTypes(key).length === 0}
          <div class="px-2 py-1 text-base text-secondary-text">
            No matching types
          </div>
        {/if}
      </div>
    </div>
  </DropdownMenu>
{/snippet}

<div>
  <span class="text-base text-white-text">Topic bindings</span>
  <div class="text-secondary-text text-sm mt-1">
    The most specific filter wins. Equal filters use list order.
  </div>
  {#if connected}
    <div class="text-secondary-text text-sm mt-1">
      Bindings apply immediately.
    </div>
  {/if}

  <div class="mt-4 space-y-4">
    {#if rules.length === 0 && draft === null}
      <div class="text-secondary-text text-sm">
        {status.dirMissing
          ? "Import your .proto files first."
          : "No bindings yet. Sparkplug topics still decode."}
      </div>
    {/if}
    {#each rules as rule, index (rule.id)}
      {@const error = rowError(rule, index)}
      <div>
        <div class="flex gap-3 items-center">
          {#if showReorder}
            <div class="flex flex-col -my-1">
              <IconButton
                tooltipText="Move up"
                disabled={disabled || index === 0}
                onClick={() => onMove(rule.id, "up")}
              >
                <Icon type="up" size={12} />
              </IconButton>
              <IconButton
                tooltipText="Move down"
                disabled={disabled || index === rules.length - 1}
                onClick={() => onMove(rule.id, "down")}
              >
                <Icon type="down" size={12} />
              </IconButton>
            </div>
          {/if}
          <div class="flex-grow">
            <BaseInput
              {disabled}
              name={`proto-binding-filter-${rule.id}`}
              placeholder="sensors/+/telemetry"
              value={rowFilterValue(rule)}
              hasError={!!error}
              onChange={(value) => onRowFilterChange(rule, value ?? "")}
              onBlur={() => onRowFilterBlur(rule)}
            />
          </div>
          {@render typePicker(rule.id, rule.messageType, (name) =>
            onUpdate(rule.id, { messageType: name })
          )}
          <Button
            {disabled}
            variant="text"
            iconType="closeCircle"
            aria-label="Delete binding"
            on:click={() => onDelete(rule.id)}
          />
        </div>
        {#if error}
          <div class="text-error text-sm mt-1">{error}</div>
        {:else if isStaleType(rule.messageType)}
          <div class="text-warning text-sm mt-1">
            {rule.messageType} is not in the loaded files
          </div>
        {/if}
      </div>
    {/each}
    {#if draft !== null}
      {@const draftError = validateTopicFilter(draft.topicFilter)}
      {@const showDraftError = draftTouched && !!draftError}
      <div>
        <div class="flex gap-3 items-center">
          {#if showReorder}
            <!-- Equal-width spacer for the reorder column so the draft
                 row's input lines up with committed rows. Invisible rather
                 than omitted so it still takes up layout space. -->
            <div class="flex flex-col -my-1 invisible" aria-hidden="true">
              <IconButton tooltipText="" disabled onClick={() => {}}>
                <Icon type="up" size={12} />
              </IconButton>
              <IconButton tooltipText="" disabled onClick={() => {}}>
                <Icon type="down" size={12} />
              </IconButton>
            </div>
          {/if}
          <div class="flex-grow">
            <BaseInput
              {disabled}
              name="proto-binding-filter-draft"
              placeholder="sensors/+/telemetry"
              value={draft.topicFilter}
              hasError={showDraftError}
              autofocus
              bind:inputEl={draftInputEl}
              onChange={(value) => onDraftFilterChange(value ?? "")}
              onBlur={onDraftFilterBlur}
            />
          </div>
          {@render typePicker("draft", draft.messageType, onDraftTypePicked)}
          <Button
            disabled={disabled || draftSubmitting}
            variant="text"
            iconType="closeCircle"
            aria-label="Cancel"
            on:click={onDraftCancel}
          />
        </div>
        {#if showDraftError}
          <div class="text-error text-sm mt-1">{draftError}</div>
        {/if}
      </div>
    {/if}
  </div>

  <AddFieldButton
    class="mt-4"
    text="Add binding"
    disabled={disabled || draft !== null}
    onClick={onAddClicked}
  />

  <div class="mt-8">
    <BaseInput
      {disabled}
      name="proto-binding-tester"
      label="Try a topic"
      bind:value={testTopic}
    />
    {#if testError}
      <div class="text-warning text-sm mt-2">Could not check that topic.</div>
    {:else if testResult !== undefined}
      <div class="text-secondary-text text-sm mt-2">
        {#if testResult === null}
          No match. Payload stays raw.
        {:else if testResult.source === "sparkplug"}
          Sparkplug topic, decodes as
          <span class="font-mono text-white-text">{testResult.messageType}</span>
        {:else if testResult.messageType}
          Matches
          <span class="font-mono text-white-text">{testResult.filter}</span>,
          decodes as
          <span class="font-mono text-white-text">{testResult.messageType}</span>
        {:else}
          Matches
          <span class="font-mono text-white-text">{testResult.filter}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>
