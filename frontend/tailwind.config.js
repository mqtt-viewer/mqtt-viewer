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
          DEFAULT: "#7c8cff",
          light: "#9aa1fe",
        },
        secondary: {
          DEFAULT: "#f7d66a",
        },
        "white-text": {
          DEFAULT: "rgba(255, 255, 255, 0.9)",
        },
        "secondary-text": {
          DEFAULT: "rgb(161, 161, 170)",
        },
        outline: {
          DEFAULT: "rgb(30, 30, 30)",
        },
        button: {
          DEFAULT: "rgb(30, 30, 30)",
        },
        switch: {
          DEFAULT: "rgb(38, 38, 42)",
        },
        hovered: {
          DEFAULT: "rgb(40, 40, 40)",
        },
        selected: {
          DEFAULT: "#353535",
        },
        divider: {
          DEFAULT: "#505050",
        },
        success: {
          DEFAULT: "rgb(72, 187, 120)",
        },
        error: {
          DEFAULT: "rgb(239, 68, 68)",
          light: "rgb(240, 110, 110)",
        },
        warning: {
          DEFAULT: "orange",
        },
        "highlight-background": {
          DEFAULT: "#534420",
        },
        "highlight-text": {
          DEFAULT: "F1E2BE",
        },
        "elevation-0": {
          DEFAULT: "#020202",
        },
        "elevation-0-hover": {
          DEFAULT: "rgb(15, 15, 15)",
        },
        "elevation-1": {
          DEFAULT: "rgb(18, 18, 18)",
        },
        "elevation-1-card": {
          DEFAULT: "rgb(22, 22, 22)",
        },
        "elevation-1-selected": {
          DEFAULT: "rgba(39, 39, 39, 1)",
        },
        "elevation-2": {
          DEFAULT: "rgb(30, 30, 30)",
        },
        "elevation-2-selected": {
          DEFAULT: "rgba(255, 85, 0, 0.3)",
        },
        "elevation-2-hover": {
          DEFAULT: "rgb(50, 50, 50)",
        },
      },
    },
  },
};
