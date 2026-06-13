// Storybook mock for @wailsio/runtime.
// Provides the subset of the Wails v3 runtime API used by the app:
// Events, Browser, Window and System.

interface MockWailsEvent {
  name: string;
  data: any;
}

type Listener = (e: MockWailsEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export const Events = {
  On(eventName: string, callback: Listener): () => void {
    const eventListeners = listeners.get(eventName) ?? new Set<Listener>();
    eventListeners.add(callback);
    listeners.set(eventName, eventListeners);
    return () => eventListeners.delete(callback);
  },
  Once(eventName: string, callback: Listener): () => void {
    const off = Events.On(eventName, (e) => {
      off();
      callback(e);
    });
    return off;
  },
  OnMultiple(
    eventName: string,
    callback: Listener,
    maxCallbacks: number
  ): () => void {
    let count = 0;
    const off = Events.On(eventName, (e) => {
      if (count >= maxCallbacks) return;
      count += 1;
      callback(e);
    });
    return off;
  },
  Off(eventName: string, ...additionalEventNames: string[]): void {
    listeners.delete(eventName);
    for (const name of additionalEventNames) listeners.delete(name);
  },
  OffAll(): void {
    listeners.clear();
  },
  async Emit(name: string, data?: any): Promise<boolean> {
    const event: MockWailsEvent = { name, data };
    for (const listener of listeners.get(name) ?? []) listener(event);
    return true;
  },
};

export const Browser = {
  async OpenURL(url: string | URL): Promise<void> {
    console.info("Storybook Browser.OpenURL", String(url));
  },
};

export const Window = {
  async IsFullscreen(): Promise<boolean> {
    return false;
  },
  async Size(): Promise<{ width: number; height: number }> {
    return { width: 1280, height: 800 };
  },
};

export const System = {
  async Environment(): Promise<{
    OS: string;
    Arch: string;
    Debug: boolean;
    OSInfo: { Branding: string; ID: string; Name: string; Version: string };
    PlatformInfo: Record<string, any>;
  }> {
    return {
      OS: "darwin",
      Arch: "arm64",
      Debug: true,
      OSInfo: { Branding: "", ID: "", Name: "Storybook", Version: "0" },
      PlatformInfo: {},
    };
  },
  IsMac(): boolean {
    return true;
  },
  IsWindows(): boolean {
    return false;
  },
  IsLinux(): boolean {
    return false;
  },
  IsDebug(): boolean {
    return true;
  },
};

// Used by generated bindings; not exercised in Storybook because the
// bindings themselves are mocked, but kept for API compatibility.
export const Create = {
  Any: (v: any) => v,
  Array: () => (v: any) => v,
  Map: () => (v: any) => v,
  Nullable: () => (v: any) => v,
};

export class CancellablePromise<T> extends Promise<T> {
  cancel(): void {}
}
