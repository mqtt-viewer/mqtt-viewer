const assign = <T extends object>(target: T, source: any = {}) => Object.assign(target, source);

export namespace events {
  export enum GlobalEvent {
    ConnectionDeleted = "ConnectionDeleted",
    UpdateAvailable = "UpdateAvailable",
  }

  export class ConnectionEventsSet {
    mqttConnected = "storybook:mqttConnected";
    mqttDisconnected = "storybook:mqttDisconnected";
    mqttConnecting = "storybook:mqttConnecting";
    mqttReconnecting = "storybook:mqttReconnecting";
    mqttClientError = "storybook:mqttClientError";
    mqttMessages = "storybook:mqttMessages";
    mqttLatency = "storybook:mqttLatency";
    mqttClearHistory = "storybook:mqttClearHistory";

    static createFrom(source: any = {}) {
      return new ConnectionEventsSet(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }
}

export namespace models {
  export class Subscription {
    id = 0;
    createdAt: any = null;
    updatedAt: any = null;
    connectionId = 0;
    qos?: number = 0;
    topic = "";

    static createFrom(source: any = {}) {
      return new Subscription(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class PublishHistory {
    id = 0;
    connectionId = 0;
    topic = "";
    qos = 0;
    retain = false;
    payload = "";
    encoding = "none";
    format = "none";
    userProperties?: string;
    headerContentType?: string;
    headerResponseTopic?: string;
    headerCorrelationData?: string;
    headerPayloadFormatIndicator?: boolean;
    headerMessageExpiryInterval?: number;
    headerTopicAlias?: number;
    headerSubscriptionIdentifier?: number;
    publishedAt: any = null;

    static createFrom(source: any = {}) {
      return new PublishHistory(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class FilterHistory {
    id = 0;
    connectionId = 0;
    text = "";
    lastUsed: any = null;

    static createFrom(source: any = {}) {
      return new FilterHistory(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class Connection {
    id = 0;
    createdAt: any = null;
    updatedAt: any = null;
    name = "";
    mqttVersion = "5";
    hasCustomClientId?: boolean = false;
    clientId: any = null;
    protocol = "mqtt";
    host = "localhost";
    port = 1883;
    websocketPath = "/mqtt";
    username: any = null;
    password: any = null;
    isProtoEnabled?: boolean = false;
    isCertsEnabled?: boolean = false;
    skipCertVerification?: boolean = false;
    certCa: any = null;
    certClient: any = null;
    certClientKey: any = null;
    subscriptions: Subscription[] = [];
    lastConnectedAt: any = null;
    customIconSeed: any = null;
    filterHistories: FilterHistory[] = [];
    publishHistories: PublishHistory[] = [];

    static createFrom(source: any = {}) {
      return new Connection(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class PanelSize {
    id = "";
    size = 0;
    isOpen = true;

    static createFrom(source: any = {}) {
      return new PanelSize(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class SortState {
    id = "";
    sortCriteria = "topic";
    sortDirection = "desc";

    static createFrom(source: any = {}) {
      return new SortState(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class Tab {
    id = 0;
    tabIndex = 0;
    connectionId = 0;
    connection = new Connection();

    static createFrom(source: any = {}) {
      return new Tab(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }
}

export namespace app {
  export class Connection {
    connectionDetails = new models.Connection();
    isConnected = false;
    eventSet = new events.ConnectionEventsSet();

    static createFrom(source: any = {}) {
      return new Connection(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class Connections {
    connections: { [key: number]: Connection } = {};

    static createFrom(source: any = {}) {
      return new Connections(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class EnvInfo {
    isDev = true;
    serverAddress = "localhost";
    version = "storybook";

    static createFrom(source: any = {}) {
      return new EnvInfo(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class MqttStats {
    totalMessagesReceived = 128;
    totalMessagesSent = 42;
    totalBytesReceived = 65536;
    totalBytesSent = 8192;
    statsByConnection: { [key: number]: mqtt.ConnectionStats } = {};

    static createFrom(source: any = {}) {
      return new MqttStats(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class PublishProperties {
    contentType?: string;
    payloadFormatIndicator = false;
    messageExpiryInterval?: number;
    topicAlias?: number;
    responseTopic?: string;
    correlationData?: string;
    subscriptionIdentifier?: number;
    userProperties?: { [key: string]: string };

    static createFrom(source: any = {}) {
      return new PublishProperties(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class PublishParams {
    topic = "";
    qos = 0;
    payload = "";
    retain = false;
    properties = new PublishProperties();

    static createFrom(source: any = {}) {
      return new PublishParams(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class SavePublishHistoryEntryParams {
    connectionId = 0;
    topic = "";
    payload = "";
    qos = 0;
    retain = false;
    encoding = "none";
    format = "none";
    headerContentType?: string;
    headerResponseTopic?: string;
    headerCorrelationData?: string;
    headerPayloadFormatIndicator?: boolean;
    headerMessageExpiryInterval?: number;
    headerTopicAlias?: number;
    headerSubscriptionIdentifier?: number;
    userProperties?: string;

    static createFrom(source: any = {}) {
      return new SavePublishHistoryEntryParams(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class StartupOptions {
    static createFrom(source: any = {}) {
      return new StartupOptions(source);
    }

    constructor(_source: any = {}) {}
  }
}

export namespace mqtt {
  export class ConnectionStats {
    messagesReceived = 0;
    messagesSent = 0;
    bytesReceived = 0;
    bytesSent = 0;

    static createFrom(source: any = {}) {
      return new ConnectionStats(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class MessageProperties {
    correlationData: number[] | string = "";
    contentType = "application/json";
    responseTopic = "";
    payloadFormat?: number;
    messageExpiry?: number;
    subscriptionIdentifier?: number;
    topicAlias?: number;
    userProperties: { [key: string]: string } = {};

    static createFrom(source: any = {}) {
      return new MessageProperties(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }

  export class MqttMessage {
    id = "";
    topic = "";
    payload: number[] | string = "";
    qos = 0;
    retain = false;
    properties?: MessageProperties;
    timeMs = Date.now();
    middlewareProperties?: { [key: string]: any };

    static createFrom(source: any = {}) {
      return new MqttMessage(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }
}

export namespace update {
  export class UpdateResponse {
    machine_id = "storybook";
    latest_version = "v9.9.9";
    can_update = false;
    release_notes = "Storybook fixture release notes.";
    notification_text = "A fixture update is available.";
    notification_url = "";
    update_url = "";

    static createFrom(source: any = {}) {
      return new UpdateResponse(source);
    }

    constructor(source: any = {}) {
      assign(this, source);
    }
  }
}

export namespace context {
  export class Context {
    static createFrom(source: any = {}) {
      return new Context(source);
    }

    constructor(_source: any = {}) {}
  }
}
