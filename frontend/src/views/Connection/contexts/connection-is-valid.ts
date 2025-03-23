import { getContext, setContext } from "svelte";
import type { Writable } from "svelte/store";

export const setConnectionIsValidContext = (store: Writable<boolean>) => {
  setContext("connectionIsValid", store);
};

export const getConnectionIsValidContext = () => {
  return getContext("connectionIsValid") as Writable<boolean>;
};
