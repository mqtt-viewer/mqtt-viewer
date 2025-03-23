import { get, writable } from "svelte/store";
import { GetSortStates, UpdateSortState } from "wailsjs/go/app/App";

interface DefaultSortStates {
  [sortId: string]: {
    sortCriteria: string;
    sortDirection: string;
  };
}

const { subscribe, set, update } = writable<DefaultSortStates>({});

const init = async () => {
  try {
    const sortStates = await GetSortStates();
    const result: DefaultSortStates = {};
    for (const state of sortStates) {
      result[state.id] = {
        sortCriteria: state.sortCriteria,
        sortDirection: state.sortDirection,
      };
    }
    set(result);
  } catch (e) {
    console.error(e);
  }
};

const updateSortState = (
  sortId: string,
  sortCriteria: string,
  sortDirection: string
) => {
  try {
    UpdateSortState(sortId, sortCriteria, sortDirection);
    update((store) => {
      store[sortId] = {
        sortCriteria,
        sortDirection,
      };
      return store;
    });
  } catch (e) {
    console.error(e);
  }
};

export default {
  subscribe,
  init,
  updateSortState,
};
