<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { writable } from "svelte/store";
  import Component from "./MetricMappingEditor.svelte";
  import { createMockBrokerStatusStore } from "@/stories/fixtures";
  import {
    AddSysMetricMapping,
    GetSysMetricMappingsByConnectionId,
  } from "bindings/mqtt-viewer/backend/app/app";
  import * as models from "bindings/mqtt-viewer/backend/models/models";

  // Seed a few mappings into the in-memory storybook binding mock so the list
  // has content. AddSysMetricMapping pushes synchronously before resolving, so
  // the rows are present by the time the dialog loads them on open.
  const seedMappings = () => {
    void GetSysMetricMappingsByConnectionId(1).then((existing) => {
      if (existing.length > 0) return;
      void AddSysMetricMapping(
        1,
        new models.SysMetricMapping({
          metricKey: "clients_connected",
          label: "Devices online",
          topic: "$SYS/broker/clients/active",
          sortOrder: 0,
        })
      );
      void AddSysMetricMapping(
        1,
        new models.SysMetricMapping({
          metricKey: "",
          label: "Line temp",
          topic: "factory/line/temperature",
          payloadPath: "temp",
          unit: "°C",
          sortOrder: 1,
        })
      );
      void AddSysMetricMapping(
        1,
        new models.SysMetricMapping({
          metricKey: "",
          label: "Stored messages",
          topic: "$SYS/broker/messages/stored",
          sortOrder: 2,
        })
      );
    });
  };
  seedMappings();

  const store = createMockBrokerStatusStore();
  const openWithMappings = writable(true);
  const openAddMode = writable(true);

  const { Story } = defineMeta({
    title: "Views/BrokerStatusWindow/MetricMappingEditor",
    component: Component,
    tags: ["autodocs"],
    parameters: { design: { type: "figma", url: "" } },
  });
</script>

<Story
  name="WithMappings"
  args={{ connectionId: 1, store, isOpen: openWithMappings, prefill: null }}
/>

<Story
  name="AddModePrefill"
  args={{
    connectionId: 1,
    store,
    isOpen: openAddMode,
    prefill: {
      topic: "$SYS/broker/heap/current",
      label: "current",
    },
  }}
/>
