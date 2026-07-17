import { writable } from "svelte/store";

export type Theme = "dark" | "light";

const STORAGE_KEY = "mqtt-viewer-theme";

const getInitialTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch (e) {
    console.error("error reading stored theme", e);
  }
  return "dark";
};

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.classList.toggle("dark", theme === "dark");
};

const createThemeStore = () => {
  const initial = getInitialTheme();
  applyTheme(initial);
  const { subscribe, update } = writable<Theme>(initial);

  // Detached chart/status windows share localStorage with the main window;
  // following storage events keeps every window on the same theme.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (e.newValue === "light" || e.newValue === "dark") {
      applyTheme(e.newValue);
      update(() => e.newValue as Theme);
    }
  });

  const set = (theme: Theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      console.error("error storing theme", e);
    }
    update(() => theme);
  };

  return {
    subscribe,
    set,
    toggle: () =>
      update((current) => {
        const next: Theme = current === "dark" ? "light" : "dark";
        applyTheme(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch (e) {
          console.error("error storing theme", e);
        }
        return next;
      }),
  };
};

const theme = createThemeStore();

export default theme;
