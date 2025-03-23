import { expect, test } from "vitest";
import { buildTreeData } from "./build-tree-data";

test("tree data is built as expected", (test) => {
  const rootRegDir = "root";
  const loadedProtoFilesWithDescriptorsMap = {
    "root/toot/one.proto": ["one", "two"],
    "root/toot/two.proto": ["three", "four"],
  };
  const treeData = buildTreeData({
    loadedRootDir: rootRegDir,
    loadedProtoFilesWithDescriptorsMap,
  });
  expect(treeData.items).toEqual([
    {
      id: "root/toot",
      title: "toot",
      type: "folder",
      children: [
        {
          id: "root/toot/one.proto",
          title: "one.proto",
          type: "file",
          children: [
            {
              id: "root/toot/one.proto/one",
              title: "one",
              type: "descriptor",
              children: [],
            },
            {
              id: "root/toot/one.proto/two",
              title: "two",
              type: "descriptor",
              children: [],
            },
          ],
        },
        {
          id: "root/toot/two.proto",
          title: "two.proto",
          type: "file",
          children: [
            {
              id: "root/toot/two.proto/three",
              title: "three",
              type: "descriptor",
              children: [],
            },
            {
              id: "root/toot/two.proto/four",
              title: "four",
              type: "descriptor",
              children: [],
            },
          ],
        },
      ],
    },
  ]);

  expect(treeData.expandableIds).toEqual([
    "root/toot",
    "root/toot/one.proto",
    "root/toot/two.proto",
  ]);
});
