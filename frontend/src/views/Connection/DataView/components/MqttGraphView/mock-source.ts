// Dev-only synthetic traffic generator. Mirrors scripts/mqtt-sim.py so the
// Topic Graph can be developed/verified in the browser without the Go backend.

import type { TopicModel } from "./topic-model";

interface MockTopic {
  topic: string;
  rate: number; // mean messages/sec; 0 = once then idle
}

function buildTopics(scale: number): MockTopic[] {
  const t: MockTopic[] = [
    { topic: "backyard/sensors/34/temperature", rate: 2.0 },
    { topic: "backyard/sensors/35/temperature", rate: 0.7 },
    { topic: "backyard/sensors/36/humidity", rate: 0.4 },
    { topic: "backyard/gateway/log", rate: 1.0 },
    { topic: "backyard/gateway/status", rate: 0.07 },
    { topic: "backyard/cam/motion", rate: 0.05 },
    { topic: "house/livingroom/temperature", rate: 0.5 },
    { topic: "house/livingroom/humidity", rate: 0.13 },
    { topic: "house/livingroom", rate: 0.05 }, // dual-role: publishes + has children
    { topic: "house/kitchen/temperature", rate: 0.1 },
    { topic: "house/kitchen/co2", rate: 0.03 },
    { topic: "house/bedroom/temperature", rate: 0.03 },
    { topic: "house/hallway/motion", rate: 0.2 },
    { topic: "garden/soil/moisture", rate: 0.25 },
    { topic: "garden/light/lux", rate: 0.15 },
    { topic: "garden/pump/status", rate: 0.004 },
    { topic: "home/config/timezone", rate: 0 },
    { topic: "home/config/firmware", rate: 0 },
    { topic: "$app/broker/clients", rate: 0.05 },
    { topic: "$app/broker/bytes", rate: 0.1 },
    { topic: "$app/broker/uptime", rate: 0.008 },
  ];
  const lines = 3 * scale;
  const rates = [0.02, 0.05, 0.1, 0.3];
  for (let ln = 1; ln <= lines; ln++) {
    for (let st = 1; st <= 8; st++) {
      const base = rates[(ln + st) % rates.length];
      const l = String(ln).padStart(2, "0");
      const s = String(st).padStart(2, "0");
      t.push({ topic: `factory/line-${l}/station-${s}/temperature`, rate: base });
      t.push({ topic: `factory/line-${l}/station-${s}/vibration`, rate: base * 0.7 });
      t.push({ topic: `factory/line-${l}/station-${s}/state`, rate: 0.02 });
    }
  }
  return t;
}

export interface MockHandle {
  stop: () => void;
  topicCount: number;
}

// Message-callback variant: emits (topic, timeMs) pairs instead of writing into
// a model — lets the real MqttGraphView component run on synthetic traffic
// (storybook / browser dev) via its messageSource prop.
export function startMockMessages(
  emit: (topic: string, timeMs: number) => void,
  scale = 1
): MockHandle {
  const topics = buildTopics(scale);
  const now = Date.now();
  for (const t of topics) if (t.rate === 0) emit(t.topic, now);

  let anomaly = false;
  let anomalyUntil = 0;
  let lastAnomaly = Date.now();

  const tick = () => {
    const t = Date.now();
    if (!anomaly && t - lastAnomaly > 25000) {
      anomaly = true;
      anomalyUntil = t + 4000;
      lastAnomaly = t;
    }
    if (anomaly && t > anomalyUntil) anomaly = false;

    for (const top of topics) {
      if (top.rate <= 0) continue;
      let rate = top.rate;
      if (anomaly && top.topic === "backyard/sensors/34/temperature") rate = 15;
      if (Math.random() < rate * 0.1) emit(top.topic, t);
    }
  };
  const id = window.setInterval(tick, 100);
  return { stop: () => window.clearInterval(id), topicCount: topics.length };
}

export function startMockTraffic(model: TopicModel, scale = 1): MockHandle {
  return startMockMessages((topic, t) => model.ingest(topic, t), scale);
}
