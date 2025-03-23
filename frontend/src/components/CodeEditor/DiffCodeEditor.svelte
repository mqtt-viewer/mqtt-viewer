<script lang="ts">
  import { MergeView } from "@codemirror/merge";
  import { Compartment } from "@codemirror/state";
  import { onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import { createEditorStateConfig } from "./createEditorStateConfig";
  import { LANG_EXTENSIONS } from "./extensions";
  import type { SupportedCodeEditorFormat } from "./formatting";

  //  Only supports readonly mode
  export let format = "json" as SupportedCodeEditorFormat;
  export let left: string;
  export let right: string;

  let langCompartmentA = new Compartment();
  let langCompartmentB = new Compartment();

  let domElement: HTMLDivElement;
  let mergeView: MergeView;

  const createMergeView = () => {
    const mergeView = new MergeView({
      a: createEditorStateConfig({
        lang: format,
        langCompartment: langCompartmentA,
        readOnly: true,
        doc: left,
      }),
      b: createEditorStateConfig({
        lang: format,
        langCompartment: langCompartmentB,
        readOnly: true,
        doc: right,
      }),
      parent: domElement,
    });
    return mergeView;
  };

  onMount(() => {
    mergeView = createMergeView();
  });

  $: format,
    (() => {
      mergeView?.a?.dispatch({
        effects: langCompartmentA.reconfigure(LANG_EXTENSIONS[format]),
      });
      mergeView?.b?.dispatch({
        effects: langCompartmentB.reconfigure(LANG_EXTENSIONS[format]),
      });
    })();

  const checkBothAreJSON = (a: string, b: string) => {
    if (a && b) {
      try {
        JSON.parse(a);
        JSON.parse(b);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  };

  $: (() => {
    if (!mergeView || !mergeView?.a.state || !mergeView?.b.state) return;
    [left, right].forEach((val, i) => {
      const editorView = i === 0 ? mergeView.a : mergeView.b;
      if (val !== editorView.state.doc.toString()) {
        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: val,
          },
        });
      }
    });
    if (checkBothAreJSON(left, right)) {
      format = "json";
    } else {
      format = "none";
    }
  })();
</script>

<div
  class={twMerge(
    "codemirror h-full w-full relative max-h-full max-w-full",
    "overflow-auto cm-readonly"
  )}
  bind:this={domElement}
></div>
