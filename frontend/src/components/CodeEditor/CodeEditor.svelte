<script lang="ts">
  import { EditorView } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { onMount } from "svelte";
  import { debounce } from "lodash";
  import { type SupportedCodeEditorFormat } from "./formatting";
  import { LANG_EXTENSIONS } from "./extensions";
  import { createEditorStateConfig } from "./createEditorStateConfig";
  import { twMerge } from "tailwind-merge";

  export let text = "";
  export let format: SupportedCodeEditorFormat = "none";
  export let readOnly = false;
  export let setEditorText = (newText: string) => {};
  onMount(() => {
    setEditorText = (newText: string) => {
      if (!view || !view?.state) return;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: newText,
        },
      });
    };
  });

  const UPDATE_DELAY_MS = 300;

  let dom: Element;
  let view: EditorView;
  let langCompartment = new Compartment();

  // Readonly handling, updates whenever payload changes
  $: text,
    (() => {
      if (!view || !view?.state) return;
      if (!readOnly) return;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: text,
        },
      });
    })();

  let startState = EditorState.create(
    createEditorStateConfig({
      readOnly,
      lang: format,
      langCompartment,
      doc: format === "json" || format === "json-prettier" ? "{\n\n}" : "",
    })
  );

  $: format,
    (() => {
      view?.dispatch({
        effects: langCompartment.reconfigure(LANG_EXTENSIONS[format]),
      });
    })();

  onMount(() => {
    view = new EditorView({
      state: startState,
      parent: dom,
      dispatch: (transaction, editorView) => {
        editorView.update([transaction]);
        if (transaction.docChanged) {
          onChange();
        }
      },
    });
  });

  const onChange = debounce(() => {
    const newValue = view.state.doc.toString();
    if (newValue === text) return;
    text = newValue;
  }, UPDATE_DELAY_MS);
</script>

<div
  id="codemirror"
  class={twMerge(
    "codemirror h-full w-full relative max-h-full max-w-full",
    "overflow-auto",
    readOnly && "cm-readonly"
  )}
  bind:this={dom}
  on:focus={() => console.log("editor focused", text)}
  on:blur={() => console.log("editor blurred", text)}
></div>
