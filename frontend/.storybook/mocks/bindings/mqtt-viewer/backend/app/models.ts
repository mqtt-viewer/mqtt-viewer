// Storybook mock for bindings/mqtt-viewer/backend/app/models.

import * as models from "../models/models";
import * as mqtt from "../mqtt/models";
import { ConnectionEventsSet } from "../../events/models";

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class Connection {
  connectionDetails = new models.Connection();
  isConnected = false;
  eventSet = new ConnectionEventsSet();

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
  headerContentType: string | null = null;
  headerResponseTopic: string | null = null;
  headerCorrelationData: string | null = null;
  headerPayloadFormatIndicator: boolean | null = null;
  headerMessageExpiryInterval: number | null = null;
  headerTopicAlias: number | null = null;
  headerSubscriptionIdentifier: number | null = null;
  userProperties: string | null = null;

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

export class CreateCollectionParams {
  name = "";
  connectionId: number | null = null;

  static createFrom(source: any = {}) {
    return new CreateCollectionParams(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}

export class SaveCollectionMessageParams {
  id: number | null = null;
  collectionId = 0;
  name = "";
  topic = "";
  payload = "";
  qos = 0;
  retain = false;
  encoding = "";
  format = "";
  headerContentType: string | null = null;
  headerResponseTopic: string | null = null;
  headerCorrelationData: string | null = null;
  headerPayloadFormatIndicator: boolean | null = null;
  headerMessageExpiryInterval: number | null = null;
  headerTopicAlias: number | null = null;
  headerSubscriptionIdentifier: number | null = null;
  userProperties: string | null = null;

  static createFrom(source: any = {}) {
    return new SaveCollectionMessageParams(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
