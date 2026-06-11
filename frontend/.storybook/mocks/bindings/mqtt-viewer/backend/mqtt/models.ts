// Storybook mock for bindings/mqtt-viewer/backend/mqtt/models.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

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
