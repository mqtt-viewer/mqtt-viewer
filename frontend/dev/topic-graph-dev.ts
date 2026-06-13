// Dev harness entry — mounts the Topic Graph renderer against synthetic traffic.
// Open at http://localhost:5173/dev/topic-graph.html
import { TopicGraphRenderer } from "@/views/Connection/DataView/components/MqttGraphView/pixi-graph";
import { TopicModel } from "@/views/Connection/DataView/components/MqttGraphView/topic-model";
import { startMockTraffic } from "@/views/Connection/DataView/components/MqttGraphView/mock-source";
import type { SortKey } from "@/views/Connection/DataView/components/MqttGraphView/tidy-layout";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;

const model = new TopicModel();
const renderer = new TopicGraphRenderer(
  model,
  {
    onSelect: (topic) => {
      renderer.setSelected(topic);
      statusEl.textContent = `selected: ${topic}`;
    },
    onToggle: () => {},
  },
  { cooldownMs: 60000 }
);

const sizeOf = () => ({
  w: window.innerWidth || canvas.clientWidth || document.body.clientWidth || 1280,
  h: window.innerHeight || canvas.clientHeight || document.body.clientHeight || 760,
});

async function main() {
  const { w, h } = sizeOf();
  await renderer.init(canvas, w, h);
  (window as any).__r = renderer;
  (window as any).__m = model;
  const mock = startMockTraffic(model, 1);

  // give it a moment of traffic so the tree exists, then lay out + fit
  setTimeout(() => {
    const s = sizeOf();
    renderer.resize(s.w, s.h);
    renderer.expandToDepth(1);
    renderer.fitView();
  }, 600);

  // pick up newly-seen topics; keep the view fitted while the tree is still growing
  let settle = 0;
  let lastCount = 0;
  window.setInterval(() => {
    renderer.notifyData();
    if (model.topicCount !== lastCount) {
      lastCount = model.topicCount;
      settle = 0;
    } else {
      settle++;
    }
    if (settle < 6) setTimeout(() => renderer.fitView(), 300);
    statusEl.textContent = `${model.topicCount} topics · ${mock.topicCount} simulated`;
  }, 500);

  let lastW = w;
  let lastH = h;
  const onResize = () => {
    const s = sizeOf();
    if (s.w === lastW && s.h === lastH) return;
    lastW = s.w;
    lastH = s.h;
    renderer.resize(s.w, s.h);
    renderer.fitView();
  };
  window.addEventListener("resize", onResize);
  new ResizeObserver(onResize).observe(document.body);

  document.getElementById("filter")!.addEventListener("input", (e) => {
    renderer.setFilter((e.target as HTMLInputElement).value);
  });
  document.getElementById("sort")!.addEventListener("change", (e) => {
    renderer.setSort((e.target as HTMLSelectElement).value as SortKey);
  });
  const expand = (d: number) => {
    renderer.expandToDepth(d);
    renderer.fitView();
  };
  document.getElementById("d1")!.addEventListener("click", () => expand(1));
  document.getElementById("d2")!.addEventListener("click", () => expand(2));
  document.getElementById("d9")!.addEventListener("click", () => expand(99));
}

main();
