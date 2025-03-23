import type { TreeItem } from "./LoadedProtoTree.svelte";
import type { TreeIconType } from "./LoadedProtoTreeItem.svelte";

export const buildTreeData = (params: {
  loadedRootDir: string;
  loadedProtoFilesWithDescriptorsMap: {
    [filePath: string]: string[];
  };
}) => {
  try {
    const { loadedRootDir, loadedProtoFilesWithDescriptorsMap } = params;
    if (!loadedRootDir || !loadedProtoFilesWithDescriptorsMap)
      return {
        items: [],
        expandableIds: [],
      };
    // Weird naming to avoid issues with filepaths containing 'treeData'
    // just in case
    let __treeData__: TreeItem[] = [];
    let expandableIds: string[] = [];
    const result = { items: __treeData__, expandableIds };
    const filePaths = Object.keys(loadedProtoFilesWithDescriptorsMap);
    if (!filePaths) return result;
    const sortedFilePaths = filePaths.sort((a, b) => a.localeCompare(b));
    let level = { __treeData__ };
    sortedFilePaths.forEach((filePath) => {
      const relativePath = filePath.replace(loadedRootDir, "");
      let splitPath = relativePath.split("/");
      if (splitPath[0] === "") {
        splitPath = splitPath.slice(1);
      }
      const fileName = splitPath[splitPath.length - 1];
      splitPath.reduce((prev: { [any: string]: any }, title, i) => {
        if (!prev[title]) {
          prev[title] = { __treeData__: [] };
          let type: TreeIconType = "folder";
          if (title === fileName) {
            type = "file";
          }
          let children = prev[title].__treeData__;
          if (i === splitPath.length - 1) {
            children = loadedProtoFilesWithDescriptorsMap[filePath].map(
              (descriptor) => {
                const id = `${loadedRootDir}/${splitPath.join(
                  "/"
                )}/${descriptor}`;
                return {
                  id,
                  type: "descriptor",
                  title: descriptor,
                  children: [],
                };
              }
            );
          }
          const id = `${loadedRootDir}/${splitPath.slice(0, i + 1).join("/")}`;
          expandableIds.push(id);
          prev.__treeData__.push({
            id,
            type,
            title,
            children,
          });
        }
        return prev[title];
      }, level);
    });
    return result;
  } catch (e) {
    throw e;
  }
};
