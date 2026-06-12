import { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// All colors resolve through the theme CSS variables defined in
// src/style.css (One Dark by default, One Light when html.light is set),
// so editors restyle on theme change without being rebuilt.

const chalky = "var(--cm-chalky)",
  coral = "var(--cm-coral)",
  cyan = "var(--cm-cyan)",
  invalid = "var(--cm-invalid)",
  ivory = "var(--cm-ivory)",
  stone = "var(--cm-stone)",
  malibu = "var(--cm-malibu)",
  sage = "var(--cm-sage)",
  whiskey = "var(--cm-whiskey)",
  violet = "var(--cm-violet)",
  darkBackground = "var(--cm-dark-background)",
  highlightBackground = "var(--cm-highlight-background)",
  background = "var(--cm-background)",
  tooltipBackground = "var(--cm-tooltip-background)",
  selection = "var(--cm-selection)",
  cursor = "var(--cm-cursor)";

/// The colors used in the theme, as CSS color strings.
const color = {
  chalky,
  coral,
  cyan,
  invalid,
  ivory,
  stone,
  malibu,
  sage,
  whiskey,
  violet,
  darkBackground,
  highlightBackground,
  background,
  tooltipBackground,
  selection,
  cursor,
};

/// The editor theme styles for One Dark.
const oneDarkTheme = EditorView.theme(
  {
    "&": {
      color: ivory,
      backgroundColor: background,
    },

    ".cm-scroller": {
      overflow: "auto",
      backgroundColor: "var(--cm-content-overlay)",
    },

    ".cm-content": {
      caretColor: cursor,
    },

    ".cm-cursor, .cm-dropCursor": { borderLeftColor: cursor },

    // --- Selection handling ---
    ".cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "var(--cm-selection-blurred)",
    },

    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      { backgroundColor: selection },
    // --------------------------

    ".cm-panels": { backgroundColor: darkBackground, color: ivory },
    ".cm-panels.cm-panels-top": {
      borderBottom: "2px solid var(--cm-panel-border)",
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: "2px solid var(--cm-panel-border)",
    },

    ".cm-searchMatch": {
      backgroundColor: "var(--cm-search-match)",
      outline: "1px solid var(--cm-search-match-outline)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--cm-search-match-selected)",
    },

    ".cm-activeLine": { backgroundColor: "var(--cm-active-line)" },
    ".cm-selectionMatch": { backgroundColor: "var(--cm-selection-match)" },

    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "var(--cm-matching-bracket)",
    },

    ".cm-gutters": {
      backgroundColor: "var(--color-elevation-1)",
      color: stone,
      border: "none",
    },

    ".cm-activeLineGutter": {
      backgroundColor: highlightBackground,
    },

    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--cm-fold-placeholder)",
    },

    ".cm-tooltip": {
      border: "none",
      backgroundColor: tooltipBackground,
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: tooltipBackground,
      borderBottomColor: tooltipBackground,
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: highlightBackground,
        color: ivory,
      },
    },
  },
  { dark: true }
);

// The highlighting style for code in the One Dark theme.
// Used within the code editor but also mounted manually
// For inline code highlighting in the tree
export const oneDarkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: violet },
  {
    tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
    color: coral,
  },
  { tag: [t.function(t.variableName), t.labelName], color: malibu },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: whiskey },
  { tag: [t.definition(t.name), t.separator], color: ivory },
  {
    tag: [
      t.typeName,
      t.className,
      t.number,
      t.changed,
      t.annotation,
      t.modifier,
      t.self,
      t.namespace,
    ],
    color: chalky,
  },
  {
    tag: [
      t.operator,
      t.operatorKeyword,
      t.url,
      t.escape,
      t.regexp,
      t.link,
      t.special(t.string),
    ],
    color: cyan,
  },
  { tag: [t.meta, t.comment], color: stone },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: stone, textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: coral },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: whiskey },
  { tag: [t.processingInstruction, t.string, t.inserted], color: sage },
  { tag: t.invalid, color: invalid },
]);

/// Extension to enable the One Dark theme (both the editor theme and
/// the highlight style).
export const oneDark: Extension = [
  oneDarkTheme,
  syntaxHighlighting(oneDarkHighlightStyle),
];
