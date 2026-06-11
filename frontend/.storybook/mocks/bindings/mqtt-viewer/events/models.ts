// Storybook mock for bindings/mqtt-viewer/events/models.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export enum GlobalEvent {
  $zero = "",
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
