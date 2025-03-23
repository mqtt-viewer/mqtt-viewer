import { derived } from "svelte/store";
import connections from "../connections.js";

export interface ConnectionProtobufDetails {
  protoLoaded: boolean;
  protoLoadError?: string;
  countLoadedFiles: number;
  countLoadedDescriptors: number;
  loadedFileNamesWithDescriptorsMap: {
    [fileName: string]: string[];
  };
  loadedFilePathsWithDescriptorsMap: {
    [filePath: string]: string[];
  };
  loadedDescriptorNames: string[];
}

const connectionProtobufDetailsMap = derived(
  [connections],
  ([$connections]) => {
    const connectionProtobufDetailsMap: {
      [id: number]: ConnectionProtobufDetails;
    } = {};
    Object.keys($connections.connections).forEach((connId) => {
      const connection = $connections.connections[parseInt(connId)];
      const result: ConnectionProtobufDetails = {
        protoLoaded: false,
        protoLoadError: undefined,
        countLoadedFiles: 0,
        countLoadedDescriptors: 0,
        loadedFileNamesWithDescriptorsMap: {},
        loadedFilePathsWithDescriptorsMap: {},
        loadedDescriptorNames: [],
      };

      const hasError = !!connection?.protoLoadError;
      if (hasError) {
        result.protoLoadError = connection.protoLoadError;
        connectionProtobufDetailsMap[connection.connectionDetails.id] = result;
        return;
      }
      const protoLoaded = !!connection?.loadedProtoDetails?.dir;
      if (!protoLoaded) {
        connectionProtobufDetailsMap[connection.connectionDetails.id] = result;
        return;
      }
      result.protoLoaded = true;
      Object.keys(
        connection.loadedProtoDetails?.loadedFileNamesWithDescriptors ?? {}
      ).forEach((filePath) => {
        result.countLoadedFiles++;
        const loadedDescriptors =
          connection.loadedProtoDetails?.loadedFileNamesWithDescriptors[
            filePath
          ] ?? [];
        result.countLoadedDescriptors += loadedDescriptors.length;
        const fileName = filePath.split("/").pop() ?? "";
        result.loadedFileNamesWithDescriptorsMap[fileName] = loadedDescriptors;
        result.loadedFilePathsWithDescriptorsMap[filePath] = loadedDescriptors;
        result.loadedDescriptorNames.push(...loadedDescriptors);
      });
      result.loadedDescriptorNames = result.loadedDescriptorNames.sort((a, b) =>
        b.localeCompare(a)
      );
      connectionProtobufDetailsMap[connection.connectionDetails.id] = result;
    });
    return connectionProtobufDetailsMap;
  }
);

export default connectionProtobufDetailsMap;
