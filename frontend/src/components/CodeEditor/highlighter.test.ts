import { expect, test } from "vitest";
import { highlightJson } from "./highlighter";

test("json is parsed and highlighted correctly", () => {
  let object = {
    testing: 123,
    this: {
      is: "cool",
      seriously: [1, 2, 3],
      foreals: true,
    },
  };

  const expectedResult = `{<span class="ͼq">&quot;testing&quot;</span>:<span class="ͼu">123</span>,<span class="ͼq">&quot;this&quot;</span>:{<span class="ͼq">&quot;is&quot;</span>:<span class="ͼ13">&quot;cool&quot;</span>,<span class="ͼq">&quot;seriously&quot;</span>:[<span class="ͼu">1</span>,<span class="ͼu">2</span>,<span class="ͼu">3</span>],<span class="ͼq">&quot;foreals&quot;</span>:<span class="ͼ12">true</span>}}`;

  const result = highlightJson(JSON.stringify(object));
  expect(result).toBe(expectedResult);
});
