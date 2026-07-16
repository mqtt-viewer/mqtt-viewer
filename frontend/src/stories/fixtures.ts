import { writable, type Writable } from "svelte/store";
import connections from "@/stores/connections";
import defaultSorts from "@/stores/default-sorts";
import env from "@/stores/env";
import panelSizes from "@/stores/panel-sizes";
import subscriptions from "@/stores/subscriptions";
import tabs from "@/stores/tabs";
import { createSelectedTopicStore } from "@/views/Connection/DataView/stores/selected-topic-store";
import { createChartSeriesStore } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-series-store";
import { payloadTree } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/payload-fields";
import { createExpandedTopicsStore } from "@/views/Connection/DataView/components/MqttDataPanel/stores/expanded-topics";
import { createHighlightedMqttTopicsStore } from "@/views/Connection/DataView/components/MqttDataPanel/stores/highlighted-topics";
import { createSearchStore } from "@/views/Connection/DataView/components/MqttDataPanel/stores/search";
import { createSortStore } from "@/views/Connection/DataView/components/MqttDataPanel/stores/sort";

const now = Date.now();

export const mockEventSet = {
  mqttConnected: "storybook:mqttConnected",
  mqttDisconnected: "storybook:mqttDisconnected",
  mqttConnecting: "storybook:mqttConnecting",
  mqttReconnecting: "storybook:mqttReconnecting",
  mqttClientError: "storybook:mqttClientError",
  mqttMessages: "storybook:mqttMessages",
  mqttLatency: "storybook:mqttLatency",
  mqttClearHistory: "storybook:mqttClearHistory",
};

export const mockSubscriptions = [
  {
    id: 1,
    createdAt: new Date(now - 900000).toISOString(),
    updatedAt: new Date(now - 600000).toISOString(),
    connectionId: 1,
    topic: "factory/line/+/temperature",
    qos: 1,
  },
  {
    id: 2,
    createdAt: new Date(now - 800000).toISOString(),
    updatedAt: new Date(now - 500000).toISOString(),
    connectionId: 1,
    topic: "devices/+/state",
    qos: 0,
  },
];

export const mockConnectionDetails = {
  id: 1,
  createdAt: new Date(now - 1200000).toISOString(),
  updatedAt: new Date(now - 600000).toISOString(),
  name: "Local broker",
  mqttVersion: "5",
  hasCustomClientId: true,
  clientId: "mqtt-viewer-storybook",
  protocol: "mqtt",
  host: "localhost",
  port: 1883,
  websocketPath: "/mqtt",
  username: "demo",
  password: "demo",
  isProtoEnabled: true,
  isCertsEnabled: false,
  skipCertVerification: false,
  certCa: "",
  certClient: "",
  certClientKey: "",
  subscriptions: mockSubscriptions,
  lastConnectedAt: new Date(now - 300000),
  customIconSeed: "storybook-local-broker",
  filterHistories: [
    {
      id: 1,
      connectionId: 1,
      text: "factory/line",
      lastUsed: new Date(now - 30000).toISOString(),
    },
  ],
  publishHistories: [],
};

export const mockConnection = {
  connectionDetails: mockConnectionDetails,
  connectionString: "mqtt://localhost:1883",
  isConnected: true,
  eventSet: mockEventSet,
  connectionState: "connected",
  showDataPageWhileDisconnected: true,
  firstConnectedThisSessionAtMs: now - 600000,
  latencyMs: 28,
};

export const mockDisconnectedConnection = {
  ...mockConnection,
  connectionDetails: {
    ...mockConnectionDetails,
    id: 2,
    name: "Staging broker",
    host: "staging.example.com",
    customIconSeed: "storybook-staging-broker",
  },
  connectionString: "mqtts://staging.example.com:8883",
  isConnected: false,
  connectionState: "disconnected",
  latencyMs: undefined,
};

export const mockConnections = [mockConnection, mockDisconnectedConnection];

export const mockHeaders = {
  correlationData: "c3Rvcnlib29r",
  contentType: "application/json",
  responseTopic: "factory/line/command-response",
  payloadFormat: 1,
  messageExpiry: 60,
  subscriptionIdentifier: 12,
  topicAlias: 1,
  userProperties: {
    source: "storybook",
    priority: "normal",
  },
};

export const mockMqttMessages = [
  {
    id: "message-1",
    topic: "factory/line/temperature",
    payload: "eyJ0ZW1wIjoyMS40LCJ1bml0IjoiQyJ9",
    qos: 1,
    retain: false,
    properties: mockHeaders,
    timeMs: now - 120000,
    middlewareProperties: { IsDecodedProto: false },
  },
  {
    id: "message-2",
    topic: "factory/line/humidity",
    payload: "eyJodW1pZGl0eSI6NDIuOH0=",
    qos: 0,
    retain: true,
    properties: mockHeaders,
    timeMs: now - 60000,
    middlewareProperties: { IsDecodedProto: true },
  },
];

export const mockSparklinePoints = Array.from({ length: 30 }, (_, i) => ({
  t: now - (29 - i) * 2000,
  v: 40 + i * 1.5 + Math.sin(i / 2) * 6,
}));

export const mockMqttData = {
  factory: {
    subtopicCount: 1,
    messageCount: 3,
    topic: "factory",
    latestMessageTime: new Date(now - 60000),
    isDecodedProto: false,
    children: {
      line: {
        subtopicCount: 2,
        messageCount: 3,
        topic: "factory/line",
        latestMessageTime: new Date(now - 60000),
        isDecodedProto: false,
        children: {
          temperature: {
            subtopicCount: 0,
            messageCount: 2,
            topic: "factory/line/temperature",
            latestMessageTime: new Date(now - 120000),
            message: '{"temp":21.4,"unit":"C"}',
            isDecodedProto: false,
            children: {},
          },
          humidity: {
            subtopicCount: 0,
            messageCount: 1,
            topic: "factory/line/humidity",
            latestMessageTime: new Date(now - 60000),
            message: '{"humidity":42.8}',
            isDecodedProto: true,
            children: {},
          },
        },
      },
    },
  },
};

export const mockPublishHistory = [
  {
    id: 1,
    connectionId: 1,
    topic: "factory/line/command",
    payload: '{"setPoint":22}',
    qos: 1,
    retain: false,
    encoding: "none",
    format: "json",
    userProperties: '{"source":"storybook"}',
    headerContentType: "application/json",
    headerPayloadFormatIndicator: true,
    publishedAt: new Date(now - 90000).toISOString(),
  },
];

export const mockLoadedProtoFiles = {
  "/workspace/protos/sparkplug/spBv1.proto": [
    "org.eclipse.tahu.protobuf.Payload",
    "org.eclipse.tahu.protobuf.Payload.Metric",
  ],
  "/workspace/protos/custom/device.proto": ["mqtt.viewer.DeviceState"],
};

const noop = () => {};
const asyncNoop = async () => {};

let storesInitialized = false;

export const initializeStorybookStores = () => {
  if (storesInitialized) return;
  storesInitialized = true;
  env.init();
  tabs.init();
  connections.init();
  subscriptions.init();
  panelSizes.init();
  defaultSorts.init();
};

export const createMockSelectedTopicStore = () => {
  const store = createSelectedTopicStore(1, mockEventSet as any);
  store.set({
    connectionId: 1,
    connectionEventSet: mockEventSet as any,
    selectedTopic: "factory/line/temperature",
    history: mockMqttMessages.map((message) => ({
      ...message,
      payload:
        message.id === "message-1"
          ? '{"temp":21.4,"unit":"C"}'
          : '{"humidity":42.8}',
      payloadB64: message.payload,
    })) as any,
    historySource: "memory",
    window: null,
    totalCount: mockMqttMessages.length,
    options: {
      autoSelect: true,
      compare: true,
      decoding: "none",
      format: "json",
    },
    onNewMessages: null,
  });
  return store;
};

export const createMockPublishStore = () => {
  const { subscribe, set, update } = writable({
    connectionId: 1,
    topic: "factory/line/command",
    payload: '{\n  "setPoint": 22\n}',
    qos: 1,
    retain: false,
    properties: {
      payloadFormatIndicator: true,
      messageExpiryInterval: 60,
      contentType: "application/json",
      responseTopic: "factory/line/command-response",
      correlationData: "storybook",
      subscriptionIdentifier: 12,
      topicAlias: 1,
    },
    userPropertiesArray: [{ key: "source", value: "storybook" }],
    codec: "none",
    format: "json",
    forceEditorTextSetIncrement: 0,
    hasAttemptedPublish: true,
    topicError: null,
    sourceMessageId: null,
    sourceMessageName: null,
    sourceCollectionId: null,
    baseline: null,
  });
  return {
    subscribe,
    set,
    setPartial: (partial: Record<string, unknown>) =>
      update((store) => ({ ...store, ...partial })),
    getUserProperties: () => ({ source: "storybook" }),
    publish: asyncNoop,
    formatPayload: () =>
      update((store) => ({
        ...store,
        payload: JSON.stringify(JSON.parse(store.payload), null, 2),
      })),
    setSource: noop,
    markSaved: noop,
  };
};

export const mockCollectionMessage = {
  id: 1,
  collectionId: 1,
  name: "Doorbell ping",
  topic: "home/doorbell/ping",
  payload: '{"ding":"dong"}',
  qos: 0,
  retain: false,
  encoding: "none",
  format: "json",
};

export const mockCollections = [
  {
    id: 1,
    name: "Funzone",
    messages: [
      mockCollectionMessage,
      {
        id: 2,
        collectionId: 1,
        name: "All-lights off",
        topic: "home/lights/all",
        payload: '{"state":"off"}',
        qos: 1,
        retain: true,
        encoding: "none",
        format: "json",
      },
    ],
  },
  {
    id: 2,
    connectionId: 1,
    name: "Development",
    messages: [
      {
        id: 3,
        collectionId: 2,
        name: "Backyard sensor",
        topic: "backyard/sensors/1",
        payload: '{"temp":45,"hello":"world"}',
        qos: 0,
        retain: false,
        encoding: "none",
        format: "json",
      },
    ],
  },
];

export const createMockChartSeriesStore = () =>
  createChartSeriesStore([
    { path: "temp", label: "temp", color: "#f5a623", visible: true },
    { path: "humidity", label: "humidity", color: "#7788fc", visible: true },
  ]);

export const mockPayloadTree = payloadTree(
  '{"temp":24.6,"humidity":61,"pressure":"1013.2","sensor":{"rssi":-72},"status":"ok"}'
);

export const createMockCollectionsStore = () => {
  const { subscribe } = writable({
    collections: mockCollections,
    isLoaded: true,
  });
  return {
    subscribe,
    load: asyncNoop,
    createCollection: async (name: string, scope: string) => ({
      id: 99,
      name,
      connectionId: scope === "connection" ? 1 : undefined,
      messages: [],
    }),
    renameCollection: asyncNoop,
    deleteCollection: asyncNoop,
    saveMessage: async () => mockCollectionMessage,
    renameMessage: asyncNoop,
    moveMessage: asyncNoop,
    duplicateMessage: async () => mockCollectionMessage,
    deleteMessage: asyncNoop,
  };
};

export const createMockPublishHistoryStore = () => {
  const { subscribe, update } = writable({
    publishHistory: mockPublishHistory,
  });
  return {
    subscribe,
    savePublishEntry: asyncNoop,
    deletePublishEntry: async (id: number) =>
      update((store) => ({
        publishHistory: store.publishHistory.filter((entry) => entry.id !== id),
      })),
    setPublishDetailsFromHistoryEntry: noop,
  };
};

const propDefaults: Record<string, () => unknown> = {
  actionButtons: () => [{ icon: "copy", tooltip: "Copy", onClick: noop }],
  actionLabel: () => "Choose file",
  chartSeriesStore: () => createMockChartSeriesStore(),
  paused: () => false,
  showPoints: () => true,
  windowMinutes: () => 0,
  onToggle: () => noop,
  onAddFromPayload: () => noop,
  onPopOut: () => noop,
  node: () => mockPayloadTree,
  allowPress: () => true,
  ariaLabel: () => "Storybook tabs",
  bgColor: () => undefined,
  bgHoverColor: () => undefined,
  buttonClass: () => "",
  checked: () => writable(true),
  checkedBool: () => true,
  close: () => noop,
  closeOnPointerDown: () => true,
  codec: () => "none",
  collapsed: () => false,
  collapseSidebar: () => noop,
  collection: () => mockCollections[0],
  collectionsStore: () => createMockCollectionsStore(),
  config: () => ({ contextChars: 30, maxDisplayChars: 80 }),
  currentCollectionId: () => 1,
  entry: () => mockPublishHistory[0],
  expand: () => noop,
  initialValue: () => "Storybook name",
  isTopic: () => false,
  onBack: () => noop,
  onCommit: () => noop,
  onCreate: () => asyncNoop,
  onNewMessage: () => noop,
  onOpenEntry: () => noop,
  onOpenMessage: () => noop,
  onSearch: () => noop,
  onSelect: () => noop,
  scope: () => "global",
  connection: () => mockConnection,
  connectionId: () => 1,
  connectionIsValid: () => true,
  connections: () => mockConnections,
  data: () => ({
    contentType: "application/json",
    payloadFormatIndicator: true,
    messageExpiryInterval: 60,
    topicAlias: 1,
    responseTopic: "factory/line/command-response",
    correlationData: "storybook",
    subscriptionIdentifier: 12,
  }),
  defaultChecked: () => true,
  defaultTab: () => 0,
  defaultValue: () => "mqtt",
  defaultValueText: () => "mqtt",
  deleteRetainedMessage: () => asyncNoop,
  disabled: () => false,
  errorMessage: () => "Field is required",
  expandedTopicsStore: () => {
    const store = createExpandedTopicsStore();
    store.expandMultipleTopics(["factory", "factory/line"]);
    return store;
  },
  exportTopicMessages: () => asyncNoop,
  feedbackText: () => "Copied",
  firstConnectedAtMs: () => now - 600000,
  forceOpen: () => true,
  format: () => "json",
  formatPayload: () => noop,
  getAllTopics: () => () => [
    "factory",
    "factory/line",
    "factory/line/temperature",
  ],
  getMatchingSubscription: () => async () => mockSubscriptions[0],
  getOptionDisplay: () => (option?: unknown) => String(option ?? "None"),
  getOptionLabel: () => (option?: unknown) => String(option ?? "None"),
  getTopicMatchesSubscription: () => async () => mockSubscriptions[0],
  hasError: () => false,
  headers: () => mockHeaders,
  headersToCompare: () => ({ ...mockHeaders, contentType: "text/plain" }),
  height: () => 20,
  highlightedTopicStore: () => createHighlightedMqttTopicsStore(),
  icon: () => "settings",
  iconClass: () => "text-primary",
  iconPlacement: () => "left",
  iconSize: () => 18,
  iconType: () => "settings",
  id: () => "storybook-panel",
  inputClass: () => "",
  inputEl: () => undefined,
  isActive: () => true,
  isAutoSelectingMostRecent: () => true,
  isComparing: () => true,
  isDecodedProto: () => false,
  isExpanded: () => true,
  isOpen: () => writable(true),
  isPublishDisabled: () => false,
  isReadyOnly: () => false,
  isSelected: () => true,
  label: () => "Enable option",
  left: () => '{"before": true}',
  loadedProtoFilesWithDescriptorsMap: () => mockLoadedProtoFiles,
  loadedRootDir: () => "/workspace/protos",
  maxContainerWidth: () => 720,
  maxSize: () => 520,
  message: () => '{"temp":21.4,"unit":"C"}',
  messageCount: () => 12,
  minSize: () => 180,
  mqttData: () => mockMqttData,
  mqttVersion: () => "5",
  name: () => "storybook-field",
  newTabButtonWidth: () => 126,
  noTitleMargin: () => false,
  onBlur: () => noop,
  onCancel: () => noop,
  onChange: () => noop,
  onClick: () => noop,
  onConfirm: () => noop,
  onCrossClick: () => noop,
  onDeleteClick: () => noop,
  onDescriptorSelect: () => noop,
  onFileChosen: () => noop,
  onFileRemoved: () => noop,
  onFocus: () => noop,
  onMessageSelect: () => noop,
  onTopicSelect: () => noop,
  open: () => writable(true),
  openDelay: () => 120,
  options: () => ["mqtt", "mqtts", "ws", "wss"],
  payload: () => '{"temp":21.4,"unit":"C"}',
  payloadLeftForCompare: () => '{"temp":20.9,"unit":"C"}',
  placement: () => "bottom",
  placeholder: () => "Select an option",
  preventFocus: () => false,
  publishHistoryStore: () => createMockPublishHistoryStore(),
  publishStore: () => createMockPublishStore(),
  readOnly: () => false,
  resizeEdge: () => "right",
  retain: () => false,
  right: () => '{"after": true}',
  rowName: () => "Content Type",
  rowValue: () => "application/json",
  rowValueDiff: () => "+",
  rowValueToCompare: () => "text/plain",
  rowValueToCompareDiff: () => "-",
  sameWidth: () => false,
  searchStore: () => createSearchStore(),
  searchString: () => "factory",
  searchTerm: () => "line",
  searchText: () => "line",
  selected: () => writable({ label: "MQTT", value: "mqtt" }),
  selectedArrivedAtMs: () => now - 60000,
  selectedDescriptor: () => "org.eclipse.tahu.protobuf.Payload",
  selectedDescriptorIsMissing: () => false,
  selectedRetain: () => false,
  selectedTopic: () => "factory/line/temperature",
  selectedTopicStore: () => createMockSelectedTopicStore(),
  setEditorText: () => noop,
  setValue: () => noop,
  showCloseButton: () => true,
  size: () => "medium",
  sortDir: () => "desc",
  sortKey: () => "topic",
  sortStore: () => createSortStore({ key: "topic", dir: "desc" }),
  startEmpty: () => false,
  state: () => "connected",
  subtopicCount: () => 2,
  syntaxHighlight: () => true,
  tabs: () => [
    { title: "Payload" },
    { title: "Headers" },
    { title: "User Properties" },
  ],
  text: () => "Storybook content",
  textToCopy: () => '{"temp":21.4}',
  textToCopyOnLeft: () => '{"temp":20.9}',
  timestamp: () => new Date(now - 90000).toISOString(),
  title: () => "Storybook item",
  toggleExpansion: () => noop,
  tooltipOpenDelay: () => 120,
  tooltipPlacement: () => "bottom",
  tooltipText: () => "Copy value",
  topic: () => "factory/line/temperature",
  topicLevel: () => "temperature",
  triggerClass: () => "",
  triggerIconSize: () => 16,
  triggerText: () => "Actions",
  triggerVariant: () => "secondary",
  treeItems: () => [
    {
      id: "/workspace/protos/sparkplug/spBv1.proto",
      title: "spBv1.proto",
      type: "file",
      children: [
        {
          id: "org.eclipse.tahu.protobuf.Payload",
          title: "org.eclipse.tahu.protobuf.Payload",
          type: "descriptor",
        },
      ],
    },
  ],
  type: () => "settings",
  userProperties: () => [{ key: "source", value: "storybook" }],
  userPropertiesToCompare: () => ({ source: "previous", priority: "low" }),
  value: () => "Storybook value",
  valueDiff: () => "+",
  valueLabel: () => "Selected path",
  variant: () => "secondary",
  width: () => 360,
};

const componentDefaults: Record<string, Record<string, unknown>> = {
  FieldPicker: {
    node: mockPayloadTree,
    selected: new Map([
      ["temp", "#f5a623"],
      ["humidity", "#7788fc"],
    ]),
    onToggle: noop,
  },
  TopicChart: { style: "line" },
  ChartView: { topic: "factory/line/temperature" },
  ChartOptions: { style: "line" },
  BaseNumberInput: { value: 42, label: "Port", name: "port" },
  BigAddConnectionButton: { onClick: noop },
  Button: { variant: "secondary", iconType: "plus", iconPlacement: "left" },
  CodeEditor: { text: '{\n  "temp": 21.4\n}', format: "json" },
  ConnectionStatusCircle: { state: "connected" },
  DiffCodeEditor: { format: "json" },
  FeedbackDialog: { open: writable(true) },
  FilePathPicker: {
    variant: "certificate",
    actionLabel: "Choose certificate",
    valueLabel: "Certificate",
    value: "/Users/sam/certs/client.pem",
  },
  GiveFeedbackCard: {
    icon: "feature",
    iconClass: "text-success",
    title: "I have an idea",
    text: "Suggest a feature or workflow improvement.",
  },
  Icon: { type: "settings", size: 24 },
  IconButton: { tooltipText: "Settings" },
  LoadedProtoDetailsDialog: { open: writable(true) },
  PublishPanel: { isOpen: true, open: noop, close: noop },
  ConfirmDeleteDialog: {
    isOpen: writable(true),
    title: "Delete collection",
    description: 'Delete "Funzone"? The 2 messages in it will also be deleted.',
  },
  InlineNameInput: { name: "inline-name" },
  PublishView: { isPublishDisabled: false },
  SavedMessageRow: { message: mockCollectionMessage },
  SearchMessagesModal: { isOpen: writable(true) },
  Sidebar: { isOpen: true, open: noop, close: noop },
  Sparkline: { points: mockSparklinePoints, height: 28 },
  StatTile: {
    label: "Msgs/s in",
    value: "1.2k",
    unit: "/s",
    points: mockSparklinePoints,
  },
  Select: {
    options: ["mqtt", "mqtts", "ws", "wss"],
    defaultValue: "mqtt",
    getOptionLabel: (option: unknown) => String(option).toUpperCase(),
  },
  Switch: { name: "tls", label: "TLS enabled" },
};

export const getStoryArgs = (
  _storyId: string,
  componentName: string,
  props: string[]
) => {
  const args: Record<string, unknown> = {};
  for (const prop of props) {
    const factory = propDefaults[prop];
    if (factory) args[prop] = factory();
  }
  return { ...args, ...(componentDefaults[componentName] ?? {}) };
};

export const getStoryArgTypes = (_componentName: string, props: string[]) => {
  const enumOptions: Record<string, string[]> = {
    as: ["button", "a", "div"],
    codec: ["none", "base64", "hex"],
    format: ["none", "json", "json-prettier", "xml"],
    iconPlacement: ["left", "right"],
    mqttVersion: ["3", "5"],
    placement: ["top", "right", "bottom", "left"],
    resizeEdge: ["left", "right"],
    size: ["small", "medium"],
    sortDir: ["asc", "desc"],
    sortKey: ["topic", "time"],
    state: ["connected", "disconnected", "connecting", "reconnecting"],
    triggerVariant: ["primary", "secondary", "text"],
    variant: ["primary", "secondary", "text"],
  };
  return Object.fromEntries(
    props
      .filter((prop) => enumOptions[prop])
      .map((prop) => [prop, { control: "select", options: enumOptions[prop] }])
  );
};

export const getStoryChildren = (componentName: string) => {
  if (componentName === "Button") return "Run query";
  if (componentName === "AddFieldButton") return "Add field";
  if (componentName === "Card") return "Card content";
  if (componentName === "DialogActionBar") return "Dialog actions";
  if (componentName === "DropdownMenuItem") return "Menu item";
  if (componentName === "PanelHeader") return "Panel header";
  if (componentName === "PageHeaderBar") return "Page header";
  if (componentName === "Tooltip") return "Hover target";
  return "Storybook preview";
};
