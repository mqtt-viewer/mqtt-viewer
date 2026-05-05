import { Browser, Events, System, Window } from "@wailsio/runtime";

export function BrowserOpenURL(url: string): Promise<void> {
  return Browser.OpenURL(url);
}

export function EventsOn(eventName: string, callback: (...data: any[]) => void): () => void {
  return Events.On(eventName, (event) => {
    if (Array.isArray(event.data)) {
      callback(...event.data);
      return;
    }
    callback(event.data);
  });
}

export function EventsOff(eventName: string, ...additionalEventNames: string[]): void {
  Events.Off(eventName, ...additionalEventNames);
}

export async function Environment(): Promise<{ buildType: string; platform: string; arch: string }> {
  const env = await System.Environment();
  return {
    buildType: env.Debug ? "development" : "production",
    platform: env.OS,
    arch: env.Arch,
  };
}

export async function WindowGetSize(): Promise<{ w: number; h: number }> {
  const size = await Window.Size();
  return { w: size.width, h: size.height };
}

export function WindowIsFullscreen(): Promise<boolean> {
  return Window.IsFullscreen();
}
