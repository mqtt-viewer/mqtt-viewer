// Storybook mock for bindings/mqtt-viewer/backend/update/models.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class UpdateResponse {
  latest_version = "v9.9.9";
  can_update = false;
  release_notes = "Storybook fixture release notes.";
  notification_text = "A fixture update is available.";
  notification_url = "";

  static createFrom(source: any = {}) {
    return new UpdateResponse(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
