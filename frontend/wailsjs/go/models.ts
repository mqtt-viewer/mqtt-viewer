import * as appModels from "../../bindings/mqtt-viewer/backend/app/models";
import * as eventsModels from "../../bindings/mqtt-viewer/events/models";
import * as models from "../../bindings/mqtt-viewer/backend/models/models";
import * as mqtt from "../../bindings/mqtt-viewer/backend/mqtt/models";
import * as update from "../../bindings/mqtt-viewer/backend/update/models";

export { models, mqtt, update };

export namespace app {
  export import Connection = appModels.Connection;
  export import EnvInfo = appModels.EnvInfo;
  export import PublishParams = appModels.PublishParams;
  export import PublishProperties = appModels.PublishProperties;
  export import SavePublishHistoryEntryParams = appModels.SavePublishHistoryEntryParams;
  export import StartupOptions = appModels.StartupOptions;

  export class Connections extends appModels.Connections {
    declare connections: { [key: number]: Connection };
  }

  export class MqttStats extends appModels.MqttStats {
    declare statsByConnection: { [key: number]: mqtt.ConnectionStats };
  }
}

export namespace events {
  export import ConnectionEventsSet = eventsModels.ConnectionEventsSet;

  export enum GlobalEvent {
    ConnectionDeleted = "ConnectionDeleted",
    UpdateAvailable = "UpdateAvailable",
  }
}
