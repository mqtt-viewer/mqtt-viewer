import type { Connection } from "@/stores/connections";

export const filterConnections = (
  connections: Connection[],
  searchString: string
) => {
  try {
    if (searchString === "") return connections;
    const filteredConnections = connections.filter((connection) =>
      connectionMatchesFilter(connection, searchString)
    );
    return filteredConnections;
  } catch (e) {
    throw e;
  }
};

const connectionMatchesFilter = (
  connection: Connection,
  searchString: string
) => {
  try {
    const { connectionDetails, connectionString } = connection;
    const lowerSearch = searchString.toLowerCase();
    return (
      connectionString.toLowerCase().includes(lowerSearch) ||
      connectionDetails.name.toLowerCase().includes(lowerSearch)
    );
  } catch (e) {
    throw e;
  }
};
