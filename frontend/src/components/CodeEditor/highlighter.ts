import { parser } from "@lezer/json";
import { highlightCode } from "@lezer/highlight";
import { oneDarkHighlightStyle } from "./theme";
import _ from "lodash";

export const highlightJson = (jsonString?: string) => {
  try {
    if (!jsonString || !validateJSON(jsonString)) {
      return jsonString;
    }
    let result = "";

    function emit(text: string, classes?: string) {
      const escapedText = _.escape(text);
      if (classes) {
        result += `<span class="${classes}">${escapedText}</span>`;
      } else {
        result += escapedText;
      }
    }
    function emitBreak() {
      // do nothing, we want all the text on one line
    }

    highlightCode(
      jsonString,
      parser.parse(jsonString),
      oneDarkHighlightStyle,
      emit,
      emitBreak
    );
    return result;
  } catch (e) {
    throw e;
  }
};

const validateJSON = (jsonString?: string) => {
  if (!jsonString) {
    return false;
  }
  try {
    JSON.parse(jsonString);
    return true;
  } catch (e) {
    return false;
  }
};
