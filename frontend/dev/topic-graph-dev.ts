// Dev harness entry — mounts the Topic Graph renderer against synthetic traffic
// (or a real broker via ?broker=). Open at http://localhost:5173/dev/topic-graph.html
import mqtt from "mqtt";
import { TopicGraphRenderer } from "@/views/Connection/DataView/components/MqttGraphView/pixi-graph";
import { TopicModel } from "@/views/Connection/DataView/components/MqttGraphView/topic-model";
import { startMockTraffic } from "@/views/Connection/DataView/components/MqttGraphView/mock-source";
import type { SortKey } from "@/views/Connection/DataView/components/MqttGraphView/tidy-layout";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;

const params = new URLSearchParams(window.location.search);
const scale = Number(params.get("scale") ?? "1") || 1;
const brokerUrl = params.get("broker");

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

// ---- FPS meter ----
// Tracks ticker frames over rolling 1s windows and exposes window.__perf,
// updated once a second, plus appends fps to the status line.
interface PerfSnapshot {
  fps: number;
  avgFrameMs: number;
  worstFrameMs: number;
  placedNodes: number;
  visibleNodes: number;
}
declare global {
  interface Window {
    __perf?: PerfSnapshot;
    __r?: TopicGraphRenderer;
    __m?: TopicModel;
  }
}

function installPerfMeter(r: TopicGraphRenderer): void {
  let frames = 0;
  let windowStart = performance.now();
  let worstMs = 0;
  let lastFrameTime = performance.now();

  r.app.ticker.add(() => {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    frames++;
    if (dt > worstMs) worstMs = dt;

    const elapsed = now - windowStart;
    if (elapsed >= 1000) {
      const fps = (frames * 1000) / elapsed;
      const counts = r.getPerfCounts();
      // avgFrameMs is the renderer's WORK-time EMA, not inter-frame time:
      // with the ticker capped at 60fps, inter-frame time flattens to the
      // cap (~16.7ms) regardless of load, which would blind the perf-graph
      // regression check. worstFrameMs stays inter-frame so jank spikes and
      // stalls remain visible.
      window.__perf = {
        fps: Math.round(fps * 10) / 10,
        avgFrameMs: r.getPerfStats().avgFrameMs,
        worstFrameMs: Math.round(worstMs * 100) / 100,
        placedNodes: counts.placedNodes,
        visibleNodes: counts.visibleNodes,
      };
      frames = 0;
      worstMs = 0;
      windowStart = now;
      updateStatus();
    }
  });
}

let baseStatus = "";
function updateStatus(): void {
  const p = window.__perf;
  const fpsPart = p ? ` · ${p.fps} fps (avg ${p.avgFrameMs}ms, worst ${p.worstFrameMs}ms) · visible ${p.visibleNodes}/${p.placedNodes}` : "";
  statusEl.textContent = `${baseStatus}${fpsPart}`;
}

async function connectBroker(url: string): Promise<void> {
  baseStatus = `connecting to ${url}...`;
  updateStatus();
  const client = mqtt.connect(url);
  client.on("connect", () => {
    baseStatus = `connected to ${url}`;
    updateStatus();
    client.subscribe("#", { qos: 0 });
  });
  client.on("message", (topic) => {
    model.ingest(topic, Date.now());
  });
  client.on("error", (err) => {
    baseStatus = `broker error: ${err.message}`;
    updateStatus();
  });
  client.on("close", () => {
    baseStatus = `broker connection closed (${url})`;
    updateStatus();
  });
}

async function main() {
  const { w, h } = sizeOf();
  await renderer.init(canvas, w, h);
  (window as any).__r = renderer;
  (window as any).__m = model;
  installPerfMeter(renderer);

  let mockTopicCount = 0;
  if (brokerUrl) {
    await connectBroker(brokerUrl);
  } else {
    const mock = startMockTraffic(model, scale);
    mockTopicCount = mock.topicCount;
    baseStatus = `${model.topicCount} topics · ${mockTopicCount} simulated`;
  }

  // give it a moment of traffic so the tree exists, then lay out + fit
  setTimeout(() => {
    const s = sizeOf();
    renderer.resize(s.w, s.h);
    renderer.expandToDepth(0); // match the app: start fully collapsed
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
    baseStatus = brokerUrl
      ? `${model.topicCount} topics · broker ${brokerUrl}`
      : `${model.topicCount} topics · ${mockTopicCount} simulated`;
    updateStatus();
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
