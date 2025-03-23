import { expect, test } from "vitest";
import type { MqttData } from "../../../stores/mqtt-data";
import { filterData } from "../filter";

test("mqtt data is not filtered with empty search string", () => {
  const unfilteredData: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 0,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: undefined,
          messageCount: 0,
          subtopicCount: 1,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
          },
        },
      },
    },
  };
  const filteredData = filterData(unfilteredData, "");
  expect(filteredData).toEqual(unfilteredData);
});

test("mqtt data is filtered completely with no matches", () => {
  const unfilteredData: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 0,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: undefined,
          messageCount: 0,
          subtopicCount: 1,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
          },
        },
      },
    },
  };
  const filteredData = filterData(unfilteredData, "aaaaa ");
  expect(filteredData).toEqual({});
});

test("parents are kept when child matches", () => {
  const unfilteredData: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 1,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: undefined,
          messageCount: 1,
          subtopicCount: 1,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
          },
        },
      },
    },
  };
  // const unfilteredDataString = JSON.stringify(unfilteredData);
  const filteredData = filterData(unfilteredData, "hello");
  expect(filteredData).toEqual(unfilteredData);
});

test("non-matching children on the same level as a matching child are not kept", () => {
  const unfilteredData: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 1,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: undefined,
          messageCount: 1,
          subtopicCount: 1,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
            world: {
              topic: "aaaaa/aaaaa/world",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              messageCount: 1,
              subtopicCount: 0,
              message: "world",
              children: {},
            },
          },
        },
      },
    },
  };

  const expectedResult: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 1,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: undefined,
          messageCount: 1,
          subtopicCount: 1,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
          },
        },
      },
    },
  };
  const filteredData = filterData(unfilteredData, "hello");
  expect(filteredData).toEqual(expectedResult);
});

test("parent that matches is kept when no children match", () => {
  const unfilteredData: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 1,
      subtopicCount: 1,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          isDecodedProto: false,
          latestMessageTime: new Date(),
          message: "test-message",
          messageCount: 1,
          subtopicCount: 2,
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              message: "hello",
              messageCount: 1,
              subtopicCount: 0,
              children: {},
            },
            world: {
              topic: "aaaaa/aaaaa/world",
              isDecodedProto: false,
              latestMessageTime: new Date(),
              messageCount: 1,
              subtopicCount: 0,
              message: "world",
              children: {},
            },
          },
        },
      },
    },
  };

  const expectedResult: MqttData = {
    aaaaa: {
      topic: "aaaaa",
      isDecodedProto: false,
      latestMessageTime: new Date(),
      message: undefined,
      messageCount: 1,
      subtopicCount: 1,
      children: {
        aaaaa: {
          isDecodedProto: false,
          topic: "aaaaa/aaaaa",
          latestMessageTime: new Date(),
          message: "test-message",
          messageCount: 1,
          subtopicCount: 0,
          children: {},
        },
      },
    },
  };
  const filteredData = filterData(unfilteredData, "test-message");
  expect(filteredData).toEqual(expectedResult);
});

test("search string with trailing empty space filters correctly", () => {
  const unfilteredData = {
    aaaaa: {
      topic: "aaaaa",
      message: undefined,
      children: {
        aaaaa: {
          topic: "aaaaa/aaaaa",
          message: "test-message",
          children: {
            hello: {
              topic: "aaaaa/aaaaa/hello",
              message: undefined,
              children: {},
            },
            world: {
              topic: "aaaaa/aaaaa/world",
              message: undefined,
              children: {},
            },
          },
        },
      },
    },
  } as unknown as MqttData;

  const expectedResult = {};
  const expectedResultString = JSON.stringify(expectedResult);
  const filteredData = filterData(unfilteredData, "test-message ");
  expect(JSON.stringify(filteredData)).toEqual(expectedResultString);
});
