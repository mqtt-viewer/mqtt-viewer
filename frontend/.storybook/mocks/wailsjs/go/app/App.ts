import {
  mockConnection,
  mockConnectionDetails,
  mockDisconnectedConnection,
  mockEventSet,
  mockHeaders,
  mockMqttMessages,
  mockPublishHistory,
  mockSubscriptions,
} from "@/stories/fixtures";
import { app, models, update } from "../models";

const appConnection = (connection: typeof mockConnection) => ({
  connectionDetails: connection.connectionDetails,
  isConnected: connection.isConnected,
  eventSet: connection.eventSet,
});

export async function AddSubscription(
  connectionId: number
): Promise<models.Subscription> {
  return new models.Subscription({
    id: Date.now(),
    connectionId,
    topic: "storybook/new/topic",
    qos: 0,
  });
}

export async function CheckForUpdates(): Promise<update.UpdateResponse | null> {
  return null;
}

export async function ChooseCertFile(_currentPath: string): Promise<string> {
  return "/Users/sam/certs/storybook-client.pem";
}

export async function ChooseDirectory(_currentPath: string): Promise<string> {
  return "/Users/sam/certs";
}

export async function ClearConnectionHistory(
  _connectionId: number
): Promise<void> {}
export async function ConnectMqtt(_connectionId: number): Promise<void> {}
export async function DeleteConnection(_connectionId: number): Promise<void> {}
export async function DeleteFilterHistoryEntry(
  _connectionId: number,
  _text: string
): Promise<void> {}
export async function DeletePublishHistoryEntry(_id: number): Promise<void> {}
export async function DeleteRetainedMessage(
  _connectionId: number,
  _topic: string
): Promise<void> {}
export async function DeleteSubscription(
  _connectionId: number,
  _subscriptionId: number
): Promise<void> {}
export async function DisconnectMqtt(_connectionId: number): Promise<void> {}

export async function ExportAllMessages(
  _connectionId: number
): Promise<string> {
  return "/Users/sam/exports/mqtt-messages-all.json";
}
export async function ExportTopicMessages(
  _connectionId: number,
  topic: string
): Promise<string> {
  return `/Users/sam/exports/mqtt-messages-${topic.replaceAll("/", "-")}.json`;
}

export async function GetAllConnections(): Promise<app.Connections> {
  return new app.Connections({
    connections: {
      1: appConnection(mockConnection),
      2: appConnection(mockDisconnectedConnection),
    },
  });
}

export async function GetAllSubscriptionsByConnectionId(): Promise<{
  [key: number]: models.Subscription[];
}> {
  return {
    1: mockSubscriptions.map(
      (subscription) => new models.Subscription(subscription)
    ),
  };
}

// In-memory collections so storybook interactions behave like the app
let nextCollectionId = 100;
let nextCollectionMessageId = 100;
const mockCollectionsState: models.Collection[] = [
  new models.Collection({
    id: 1,
    name: "Funzone",
    messages: [
      {
        id: 1,
        collectionId: 1,
        name: "Doorbell ping",
        topic: "home/doorbell/ping",
        payload: '{"ding":"dong"}',
        qos: 0,
        retain: false,
        encoding: "none",
        format: "json",
      },
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
  }),
  new models.Collection({
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
  }),
];

const findMockCollectionMessage = (id: number) => {
  for (const collection of mockCollectionsState) {
    const message = collection.messages.find((m) => m.id === id);
    if (message) return { collection, message };
  }
  return null;
};

export async function GetCollectionsForConnection(
  _connectionId: number
): Promise<models.Collection[]> {
  return mockCollectionsState;
}

export async function CreateCollection(
  params: app.CreateCollectionParams
): Promise<models.Collection> {
  const collection = new models.Collection({
    id: nextCollectionId++,
    name: params.name,
    connectionId: params.connectionId,
    messages: [],
  });
  mockCollectionsState.push(collection);
  return collection;
}

export async function RenameCollection(
  id: number,
  name: string
): Promise<models.Collection> {
  const collection = mockCollectionsState.find((c) => c.id === id);
  if (collection) collection.name = name;
  return collection ?? new models.Collection({ id, name });
}

export async function DeleteCollection(id: number): Promise<void> {
  const index = mockCollectionsState.findIndex((c) => c.id === id);
  if (index >= 0) mockCollectionsState.splice(index, 1);
}

export async function SaveCollectionMessage(
  params: app.SaveCollectionMessageParams
): Promise<models.CollectionMessage> {
  if (params.id) {
    const found = findMockCollectionMessage(params.id);
    if (found) {
      Object.assign(found.message, params);
      return found.message;
    }
  }
  const message = new models.CollectionMessage({
    ...params,
    id: nextCollectionMessageId++,
  });
  const collection = mockCollectionsState.find(
    (c) => c.id === params.collectionId
  );
  collection?.messages.push(message);
  return message;
}

export async function RenameCollectionMessage(
  id: number,
  name: string
): Promise<models.CollectionMessage> {
  const found = findMockCollectionMessage(id);
  if (found) found.message.name = name;
  return found?.message ?? new models.CollectionMessage({ id, name });
}

export async function MoveCollectionMessage(
  id: number,
  targetCollectionId: number
): Promise<models.CollectionMessage> {
  const found = findMockCollectionMessage(id);
  if (!found) return new models.CollectionMessage({ id });
  found.collection.messages = found.collection.messages.filter(
    (m) => m.id !== id
  );
  found.message.collectionId = targetCollectionId;
  const target = mockCollectionsState.find((c) => c.id === targetCollectionId);
  target?.messages.push(found.message);
  return found.message;
}

export async function DuplicateCollectionMessage(
  id: number
): Promise<models.CollectionMessage> {
  const found = findMockCollectionMessage(id);
  if (!found) return new models.CollectionMessage({ id });
  const copy = new models.CollectionMessage({
    ...found.message,
    id: nextCollectionMessageId++,
    name: `${found.message.name} copy`,
  });
  found.collection.messages.push(copy);
  return copy;
}

export async function DeleteCollectionMessage(id: number): Promise<void> {
  const found = findMockCollectionMessage(id);
  if (found) {
    found.collection.messages = found.collection.messages.filter(
      (m) => m.id !== id
    );
  }
}

export async function GetEnvInfo(): Promise<app.EnvInfo> {
  return new app.EnvInfo({
    isDev: true,
    serverAddress: "localhost",
    version: "storybook",
  });
}

export async function GetFilterHistoriesForConnection(
  connectionId: number
): Promise<models.FilterHistory[]> {
  return [
    new models.FilterHistory({
      id: 1,
      connectionId,
      text: "factory/line",
      lastUsed: new Date().toISOString(),
    }),
  ];
}

export async function GetMatchingSubscriptionForTopic(
  connectionId: number,
  topic: string
): Promise<models.Subscription> {
  return new models.Subscription({
    ...mockSubscriptions[0],
    connectionId,
    topic,
  });
}

export async function GetMessageHistory(
  _connectionId: number,
  _topic: string
): Promise<any[]> {
  return mockMqttMessages;
}

export async function GetMqttStats(): Promise<app.MqttStats> {
  return new app.MqttStats({
    totalMessagesReceived: 128,
    totalMessagesSent: 42,
    totalBytesReceived: 65536,
    totalBytesSent: 8192,
    statsByConnection: {
      1: {
        messagesReceived: 120,
        messagesSent: 40,
        bytesReceived: 62000,
        bytesSent: 7800,
      },
    },
  });
}

export async function GetPanelSizes(): Promise<models.PanelSize[]> {
  return [
    new models.PanelSize({ id: "storybook-panel", size: 360, isOpen: true }),
    new models.PanelSize({ id: "mqtt-data-panel", size: 420, isOpen: true }),
    new models.PanelSize({ id: "publish-panel", size: 360, isOpen: true }),
  ];
}

export async function GetPublishHistoriesForConnection(
  _connectionId: number
): Promise<models.PublishHistory[]> {
  return mockPublishHistory.map((entry) => new models.PublishHistory(entry));
}

export async function GetSortStates(): Promise<models.SortState[]> {
  return [
    new models.SortState({
      id: "mqtt-data-sort",
      sortCriteria: "topic",
      sortDirection: "desc",
    }),
  ];
}

export async function LoadOpenTabs(): Promise<models.Tab[]> {
  return [
    new models.Tab({
      id: 1,
      tabIndex: 0,
      connectionId: 1,
      connection: mockConnectionDetails,
    }),
  ];
}

export async function NewConnection(): Promise<any> {
  return appConnection({
    ...mockDisconnectedConnection,
    connectionDetails: {
      ...mockDisconnectedConnection.connectionDetails,
      id: 3,
      name: "New Storybook broker",
    },
  });
}

export async function PublishMqtt(
  _connectionId: number,
  _params: app.PublishParams
): Promise<void> {}

export async function SaveFilterHistoryEntry(
  connectionId: number,
  text: string
): Promise<models.FilterHistory> {
  return new models.FilterHistory({
    id: Date.now(),
    connectionId,
    text,
    lastUsed: new Date().toISOString(),
  });
}

export async function SavePublishHistoryEntry(
  params: app.SavePublishHistoryEntryParams
): Promise<models.PublishHistory> {
  return new models.PublishHistory({
    ...params,
    id: Date.now(),
    publishedAt: new Date().toISOString(),
  });
}

export async function StartUpdate(): Promise<void> {}
export async function Startup(
  _context: unknown,
  _options: app.StartupOptions
): Promise<void> {}
export async function UpdateConnection(
  _connection: models.Connection
): Promise<void> {}
export async function UpdateOpenConnectionTabs(
  _connectionIds: number[]
): Promise<void> {}
export async function UpdatePanelSize(
  _id: string,
  _size: number,
  _isOpen: boolean
): Promise<void> {}
export async function UpdateSortState(
  _id: string,
  _sortCriteria: string,
  _sortDirection: string
): Promise<void> {}

export async function UpdateSubscription(
  _connectionId: number,
  subscription: models.Subscription
): Promise<models.Subscription> {
  return subscription;
}

export { mockEventSet, mockHeaders };
