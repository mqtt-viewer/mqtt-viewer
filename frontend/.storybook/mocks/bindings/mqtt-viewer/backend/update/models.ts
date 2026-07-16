// Storybook mock for bindings/mqtt-viewer/backend/update/models.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class UpdateResponse {
  latest_version = "v9.9.9";
  release_notes = "Storybook fixture release notes.";
  can_self_update = false;
  install_type = "flatpak";
  update_command = "flatpak update app.mqttviewer.MQTTViewer";
  instructions = "Update MQTT Viewer through your software centre, or run:";
  releases_url = "";

  static createFrom(source: any = {}) {
    return new UpdateResponse(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
