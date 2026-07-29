// Storybook mock for bindings/mqtt-viewer/backend/topic-matching/models.
// Field names are camelCase to match the real generated bindings, which
// follow the Go struct's json tags.

const assign = <T extends object>(target: T, source: any = {}) =>
  Object.assign(target, source);

export class ProtoBindingMatch {
  messageType = "";
  filter = "";
  source = "";

  static createFrom(source: any = {}) {
    return new ProtoBindingMatch(source);
  }

  constructor(source: any = {}) {
    assign(this, source);
  }
}
