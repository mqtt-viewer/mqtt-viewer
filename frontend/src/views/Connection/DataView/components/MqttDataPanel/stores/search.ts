import _ from "lodash";
import { writable } from "svelte/store";

interface Search {
  text: string;
}

export type SearchStore = ReturnType<typeof createSearchStore>;

export const createSearchStore = () => {
  const { subscribe, set } = writable<Search>({
    text: "",
  });

  const setSearchText = (text: string) => {
    set({ text });
  };

  return { subscribe, setSearchText };
};
