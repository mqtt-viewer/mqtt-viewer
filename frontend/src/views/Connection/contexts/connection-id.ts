import { getContext, setContext } from "svelte";
import type { Writable } from "svelte/store";

export const setConnectionIdContext = (connId: number) => {
  setContext("connectionId", connId);
};

export const getConnectionIdContext = () => {
  return getContext("connectionId") as number;
};
