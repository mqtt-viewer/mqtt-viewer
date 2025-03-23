import type { Compartment } from "@codemirror/state";
import type { SupportedCodeEditorFormat } from "./formatting";
import {
  BASE_EXTENSIONS,
  READONLY_EXTENSIONS,
  EDITABLE_EXTENSIONS,
  LANG_EXTENSIONS,
} from "./extensions";

interface CreateEditorStateConfigParams {
  lang: SupportedCodeEditorFormat;
  langCompartment: Compartment;
  readOnly?: boolean;
  doc: string;
  onChange?: (doc: string) => void;
}

export const createEditorStateConfig = (
  params: CreateEditorStateConfigParams
) => {
  return {
    doc: params.doc,
    extensions: [
      ...BASE_EXTENSIONS,
      ...(params.readOnly ? READONLY_EXTENSIONS : EDITABLE_EXTENSIONS),
      params.langCompartment.of(LANG_EXTENSIONS[params.lang]),
    ],
  };
};
