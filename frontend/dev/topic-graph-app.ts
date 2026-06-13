// Harness that mounts the REAL MqttGraphView.svelte with stubbed Wails runtime +
// stores, driven by synthetic traffic. Verifies the wrapper component (toolbar,
// sizing, theme, selection, the EventsOn data path) without the Go backend.
// Open at http://localhost:5173/dev/topic-graph-app.html

import "@/custom-preflight.css";
import "@/style.css";
import { writable } from "svelte/store";

// --- stub window.runtime so wailsjs EventsOn works in the browser ---
const listeners = new Map<string, ((...a: any[]) => void)[]>();
const register = (name: string, cb: (...a: any[]) => void) => {
  const arr = listeners.get(name) ?? [];
  arr.push(cb);
  listeners.set(name, arr);
  return () => {
    const a = listeners.get(name) ?? [];
    listeners.set(
      name,
      a.filter((f) => f !== cb)
    );
  };
};
(window as any).runtime = {
  // wailsjs EventsOn delegates to EventsOnMultiple, so this is the one that matters
  EventsOnMultiple: (name: string, cb: (...a: any[]) => void) => register(name, cb),
  EventsOn: (name: string, cb: (...a: any[]) => void) => register(name, cb),
  EventsOff: (name: string) => listeners.delete(name),
  EventsOnce: (name: string, cb: (...a: any[]) => void) => register(name, cb),
  EventsEmit: () => {},
  LogPrint: () => {},
};
let emitted = 0;
let delivered = 0;
const emit = (name: string, ...data: any[]) => {
  emitted++;
  const arr = listeners.get(name) ?? [];
  delivered += arr.length;
  arr.forEach((cb) => cb(...data));
};
(window as any).__dbg = {
  listeners,
  stats: () => ({ emitted, delivered, names: [...listeners.keys()], msgsListeners: (listeners.get("msgs") ?? []).length }),
};

const MSGS = "msgs";
const CLEAR = "clear";

// --- stub stores/props the component expects ---
const sel = writable<{ selectedTopic: string | null }>({ selectedTopic: null });
const selectedTopicStore: any = {
  subscribe: sel.subscribe,
  selectTopic: (t: string) => {
    sel.set({ selectedTopic: t });
    console.log("selectTopic ->", t);
  },
};
const connection: any = {
  eventSet: { mqttMessages: MSGS, mqttClearHistory: CLEAR },
};

// --- synthetic traffic emitted as mqtt.MqttMessage-shaped objects ---
function topics(): Array<{ topic: string; rate: number }> {
  const t = [
    { topic: "backyard/sensors/34/temperature", rate: 2.0 },
    { topic: "backyard/sensors/35/temperature", rate: 0.7 },
    { topic: "backyard/sensors/36/humidity", rate: 0.4 },
    { topic: "backyard/gateway/log", rate: 1.0 },
    { topic: "backyard/cam/motion", rate: 0.05 },
    { topic: "house/livingroom/temperature", rate: 0.5 },
    { topic: "house/livingroom/humidity", rate: 0.13 },
    { topic: "house/livingroom", rate: 0.05 },
    { topic: "house/kitchen/temperature", rate: 0.1 },
    { topic: "house/hallway/motion", rate: 0.2 },
    { topic: "garden/soil/moisture", rate: 0.25 },
    { topic: "garden/light/lux", rate: 0.15 },
    { topic: "garden/pump/status", rate: 0.004 },
    { topic: "home/config/timezone", rate: 0 },
    { topic: "$app/broker/clients", rate: 0.05 },
    { topic: "$app/broker/uptime", rate: 0.008 },
  ];
  const rates = [0.02, 0.05, 0.1, 0.3];
  for (let ln = 1; ln <= 3; ln++)
    for (let st = 1; st <= 8; st++) {
      const l = String(ln).padStart(2, "0");
      const s = String(st).padStart(2, "0");
      const base = rates[(ln + st) % rates.length];
      t.push({ topic: `factory/line-${l}/station-${s}/temperature`, rate: base });
      t.push({ topic: `factory/line-${l}/station-${s}/state`, rate: 0.02 });
    }
  return t;
}

const TOPICS = topics();
for (const t of TOPICS) if (t.rate === 0) emit(MSGS, [{ topic: t.topic, timeMs: Date.now() }]);

let anomalyUntil = 0;
let lastAnomaly = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - lastAnomaly > 25000 && anomalyUntil === 0) {
    anomalyUntil = now + 4000;
    lastAnomaly = now;
  }
  if (anomalyUntil && now > anomalyUntil) anomalyUntil = 0;
  const batch: any[] = [];
  for (const t of TOPICS) {
    if (t.rate <= 0) continue;
    let rate = t.rate;
    if (anomalyUntil && t.topic === "backyard/sensors/34/temperature") rate = 15;
    if (Math.random() < rate * 0.1) batch.push({ topic: t.topic, timeMs: now });
  }
  if (batch.length) emit(MSGS, batch);
}, 100);

// --- mount the real component ---
import { mount } from "svelte";
import theme from "@/stores/theme";
import MqttGraphView from "@/views/Connection/DataView/components/MqttGraphView/MqttGraphView.svelte";
(window as any).__theme = theme;
(window as any).__sel = sel;

mount(MqttGraphView, {
  target: document.getElementById("app")!,
  props: { connection, selectedTopicStore, initialData: {}, width: 1280 },
});
