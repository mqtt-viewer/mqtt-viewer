// Storybook mock for bindings/mqtt-viewer/backend/topic-matching/models.
// Field names are PascalCase to match the real generated bindings: the Go
// struct has no json tags, so encoding/json (and the Wails generator)
// preserve the Go field names as-is.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class ProtoBindingMatch {
  MessageType = "";
  Filter = "";
  Source = "";

  static createFrom(source: any = {}) {
    return new ProtoBindingMatch(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
