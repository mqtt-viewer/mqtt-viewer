import type { Connection } from "@/stores/connections";

export const getIdenticonKey = (connection: Connection) => {
  try {
    if (!!connection.connectionDetails.customIconSeed) {
      return connection.connectionDetails.customIconSeed;
    }
    return `${connection.connectionDetails.id}-${connection.connectionDetails.createdAt}`;
  } catch (e) {
    console.error(e);
    return "a";
  }
};
