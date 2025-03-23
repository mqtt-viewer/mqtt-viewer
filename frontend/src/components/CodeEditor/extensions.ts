import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { linter, lintGutter } from "@codemirror/lint";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { oneDark } from "./theme";
import type { SupportedCodeEditorFormat } from "./formatting";

export const BASE_EXTENSIONS = [basicSetup, EditorView.lineWrapping, oneDark];

export const EDITABLE_EXTENSIONS = [keymap.of([indentWithTab])];
export const READONLY_EXTENSIONS = [
  EditorState.readOnly.of(true),
  // EditorView.editable.of(false),
  EditorView.contentAttributes.of({ tabindex: "0" }),
];
export const LANG_EXTENSIONS: {
  [key in SupportedCodeEditorFormat]: Extension[];
} = {
  json: [json(), linter(jsonParseLinter()), lintGutter()],
  "json-prettier": [json(), linter(jsonParseLinter()), lintGutter()],
  none: [],
};
