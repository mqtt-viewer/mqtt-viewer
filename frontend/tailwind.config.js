import {
  scrollbarGutter,
  scrollbarWidth,
  scrollbarColor,
} from "tailwind-scrollbar-utilities";

/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: {
    // Using src/custom-preflight.css instead
    preflight: false,
  },
  plugins: [scrollbarGutter(), scrollbarWidth(), scrollbarColor()],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,svelte}"],
  theme: {
    fontSize: {
      xs: "9px",
      sm: "11px",
      base: "13px",
      lg: "15px",
      xl: "17px",
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
        },
        secondary: {
          DEFAULT: "var(--color-secondary)",
        },
        "white-text": {
          DEFAULT: "var(--color-white-text)",
        },
        emphasis: {
          DEFAULT: "var(--color-emphasis)",
        },
        "secondary-text": {
          DEFAULT: "var(--color-secondary-text)",
        },
        outline: {
          DEFAULT: "var(--color-outline)",
        },
        button: {
          DEFAULT: "rgb(var(--color-button-rgb) / <alpha-value>)",
        },
        "button-border": {
          DEFAULT: "var(--color-button-border)",
        },
        switch: {
          DEFAULT: "var(--color-switch)",
        },
        hovered: {
          DEFAULT: "rgb(var(--color-hovered-rgb) / <alpha-value>)",
        },
        selected: {
          DEFAULT: "var(--color-selected)",
        },
        divider: {
          DEFAULT: "var(--color-divider)",
        },
        success: {
          DEFAULT: "var(--color-success)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          light: "var(--color-error-light)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
        },
        "highlight-background": {
          DEFAULT: "var(--color-highlight-background)",
        },
        "highlight-text": {
          DEFAULT: "var(--color-highlight-text)",
        },
        "elevation-0": {
          DEFAULT: "var(--color-elevation-0)",
        },
        "elevation-0-hover": {
          DEFAULT: "var(--color-elevation-0-hover)",
        },
        "elevation-1": {
          DEFAULT: "rgb(var(--color-elevation-1-rgb) / <alpha-value>)",
        },
        "elevation-1-card": {
          DEFAULT: "var(--color-elevation-1-card)",
        },
        "elevation-1-selected": {
          DEFAULT: "var(--color-elevation-1-selected)",
        },
        "elevation-2": {
          DEFAULT: "var(--color-elevation-2)",
        },
        "elevation-2-selected": {
          DEFAULT: "var(--color-elevation-2-selected)",
        },
        "elevation-2-hover": {
          DEFAULT: "var(--color-elevation-2-hover)",
        },
        "app-bar": {
          DEFAULT: "var(--color-app-bar)",
        },
        toast: {
          DEFAULT: "var(--color-toast)",
        },
        "chip-border": {
          DEFAULT: "var(--color-chip-border)",
        },
        "search-highlight-text": {
          DEFAULT: "var(--color-search-highlight-text)",
        },
        "search-highlight-bg": {
          DEFAULT: "var(--color-search-highlight-bg)",
        },
      },
    },
  },
};
