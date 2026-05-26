export interface Position {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Screen {
  isCurrent: boolean;
  isPrimary: boolean;
  width: number;
  height: number;
}

export interface EnvironmentInfo {
  buildType: string;
  platform: string;
  arch: string;
}

const listeners = new Map<string, Set<(...data: any[]) => void>>();

export function EventsEmit(eventName: string, ...data: any): void {
  for (const listener of listeners.get(eventName) ?? []) listener(...data);
}

export function EventsOn(eventName: string, callback: (...data: any[]) => void): () => void {
  const eventListeners = listeners.get(eventName) ?? new Set();
  eventListeners.add(callback);
  listeners.set(eventName, eventListeners);
  return () => eventListeners.delete(callback);
}

export function EventsOnMultiple(
  eventName: string,
  callback: (...data: any[]) => void,
  maxCallbacks: number
): () => void {
  let count = 0;
  return EventsOn(eventName, (...data) => {
    if (count >= maxCallbacks) return;
    count += 1;
    callback(...data);
  });
}

export function EventsOnce(eventName: string, callback: (...data: any[]) => void): () => void {
  const off = EventsOn(eventName, (...data) => {
    off();
    callback(...data);
  });
  return off;
}

export function EventsOff(eventName: string, ...additionalEventNames: string[]): void {
  listeners.delete(eventName);
  for (const name of additionalEventNames) listeners.delete(name);
}

export function EventsOffAll(): void {
  listeners.clear();
}

export function LogPrint(message: string): void {
  console.log(message);
}
export function LogTrace(message: string): void {
  console.debug(message);
}
export function LogDebug(message: string): void {
  console.debug(message);
}
export function LogError(message: string): void {
  console.error(message);
}
export function LogFatal(message: string): void {
  console.error(message);
}
export function LogInfo(message: string): void {
  console.info(message);
}
export function LogWarning(message: string): void {
  console.warn(message);
}

export function WindowReload(): void {}
export function WindowReloadApp(): void {}
export function WindowSetAlwaysOnTop(_value: boolean): void {}
export function WindowSetSystemDefaultTheme(): void {}
export function WindowSetLightTheme(): void {}
export function WindowSetDarkTheme(): void {}
export function WindowCenter(): void {}
export function WindowSetTitle(_title: string): void {}
export function WindowFullscreen(): void {}
export function WindowUnfullscreen(): void {}
export async function WindowIsFullscreen(): Promise<boolean> {
  return false;
}
export async function WindowSetSize(width: number, height: number): Promise<Size> {
  return { w: width, h: height };
}
export async function WindowGetSize(): Promise<Size> {
  return { w: 1280, h: 800 };
}
export function WindowSetMaxSize(_width: number, _height: number): void {}
export function WindowSetMinSize(_width: number, _height: number): void {}
export function WindowSetPosition(_x: number, _y: number): void {}
export async function WindowGetPosition(): Promise<Position> {
  return { x: 0, y: 0 };
}
export function WindowHide(): void {}
export function WindowShow(): void {}
export function WindowMaximise(): void {}
export function WindowToggleMaximise(): void {}
export function WindowUnmaximise(): void {}
export async function WindowIsMaximised(): Promise<boolean> {
  return false;
}
export function WindowMinimise(): void {}
export function WindowUnminimise(): void {}
export async function WindowIsMinimised(): Promise<boolean> {
  return false;
}
export async function WindowIsNormal(): Promise<boolean> {
  return true;
}
export function WindowSetBackgroundColour(_r: number, _g: number, _b: number, _a: number): void {}
export async function ScreenGetAll(): Promise<Screen[]> {
  return [{ isCurrent: true, isPrimary: true, width: 1440, height: 900 }];
}

export function BrowserOpenURL(url: string): void {
  console.info("Storybook BrowserOpenURL", url);
}

export async function Environment(): Promise<EnvironmentInfo> {
  return { buildType: "dev", platform: "darwin", arch: "arm64" };
}

export function Quit(): void {}
export function Hide(): void {}
export function Show(): void {}
export async function ClipboardGetText(): Promise<string> {
  return "";
}
export async function ClipboardSetText(_text: string): Promise<boolean> {
  return true;
}
export function OnFileDrop(_callback: (x: number, y: number, paths: string[]) => void, _useDropTarget: boolean): void {}
export function OnFileDropOff(): void {}
export function CanResolveFilePaths(): boolean {
  return true;
}
export function ResolveFilePaths(_files: File[]): void {}
