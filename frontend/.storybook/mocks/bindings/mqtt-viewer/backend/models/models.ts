// Storybook mock for bindings/mqtt-viewer/backend/models/models.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class AppSettings {
  id = 1;
  memoryBudgetBytes = 512 * 1024 * 1024;
  recordingEnabled = false;
  diskBudgetBytes = 1 * 1024 * 1024 * 1024;
  hasSeenHistoryPrompt = false;
  lastSeenChangelogVersion = "";
  launchCount = 0;
  hasSeenStarPrompt = false;

  static createFrom(source: any = {}) {
    return new AppSettings(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}

export class Subscription {
  id = 0;
  createdAt: any = null;
  updatedAt: any = null;
  connectionId = 0;
  qos: number | null = 0;
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
  userProperties: string | null = null;
  headerContentType: string | null = null;
  headerResponseTopic: string | null = null;
  headerCorrelationData: string | null = null;
  headerPayloadFormatIndicator: boolean | null = null;
  headerMessageExpiryInterval: number | null = null;
  headerTopicAlias: number | null = null;
  headerSubscriptionIdentifier: number | null = null;
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
  hasCustomClientId: boolean | null = false;
  clientId: any = null;
  protocol = "mqtt";
  host = "localhost";
  port = 1883;
  websocketPath = "/mqtt";
  username: any = null;
  password: any = null;
  isProtoEnabled: boolean | null = false;
  isCertsEnabled: boolean | null = false;
  skipCertVerification: boolean | null = false;
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

export class CollectionMessage {
  id = 0;
  collectionId = 0;
  name = "";
  topic = "";
  qos = 0;
  retain = false;
  payload = "";
  encoding = "";
  format = "";
  userProperties: string | null = null;
  headerContentType: string | null = null;
  headerResponseTopic: string | null = null;
  headerCorrelationData: string | null = null;
  headerPayloadFormatIndicator: boolean | null = null;
  headerMessageExpiryInterval: number | null = null;
  headerTopicAlias: number | null = null;
  headerSubscriptionIdentifier: number | null = null;
  createdAt: any = null;
  updatedAt: any = null;

  static createFrom(source: any = {}) {
    return new CollectionMessage(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}

export class Collection {
  id = 0;
  connectionId: number | null = null;
  name = "";
  createdAt: any = null;
  updatedAt: any = null;
  messages: CollectionMessage[] = [];

  static createFrom(source: any = {}) {
    return new Collection(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
