import { get, writable, type Readable, type Writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import {
  DeleteRetainedMessage,
  DeleteRetainedMessages,
  GetRetainedTopicsUnderPrefix,
} from "bindings/mqtt-viewer/backend/app/app";
import { addToast } from "@/components/Toast/Toast.svelte";
import { errorMessage } from "@/util/strings";

// Frontend-only event, with no Go counterpart: a clear performed in the
// popped-out topic window has to reach the main window, whose topic tree and
// graph hold their own copy of the retained marker. Wails relays events
// emitted from one webview to every window, and unregistered event names
// unmarshal to plain data on the Go side, so no backend change is needed.
export const RETAINED_CLEARED_EVENT = "frontend:retained-cleared";

export interface RetainedClearedEvent {
  connectionId: number;
  topics: string[];
}

// Returns the unlisten function. Ignores other connections.
export const onRetainedCleared = (
  connectionId: number,
  handler: (topics: string[]) => void
): (() => void) =>
  Events.On(RETAINED_CLEARED_EVENT, (e) => {
    const data = e.data as RetainedClearedEvent;
    if (data.connectionId !== connectionId) return;
    handler(data.topics);
  });

export interface ClearRetainedRequest {
  // The topic being cleared, or the prefix when clearing a branch.
  topic: string;
  // The exact topics that will be cleared (captured when the request is raised).
  topics: string[];
  // 0 means the single-topic case; a branch shows its count.
  count: number;
  busy: boolean;
}

export interface ClearRetainedFlow {
  isOpen: Writable<boolean>;
  request: Readable<ClearRetainedRequest>;
  requestClear: (topic: string) => void;
  requestClearBelow: (prefix: string) => Promise<void>;
  confirm: () => Promise<void>;
}

// Clearing a retained message publishes an empty retained message, which
// every other client on the broker sees. It used to fire on a single click
// with no confirmation; both the single-topic and branch cases now route
// through the confirmation dialog, which the caller renders and feeds from
// isOpen and request.
//
// Shared by the main window (DataView) and the popped-out topic window, which
// is a separate webview and so cannot reach the main window's dialog.
export const createClearRetainedFlow = (
  connectionId: number,
  options: { onCleared?: (topics: string[]) => void } = {}
): ClearRetainedFlow => {
  const isOpen = writable(false);
  const request = writable<ClearRetainedRequest>({
    topic: "",
    topics: [],
    count: 0,
    busy: false,
  });

  // Only the backend index self-heals; the tree and the graph hold their own
  // copies, and on MQTT 3 no arriving message will ever correct them. The
  // caller's onCleared handles this window; the event reaches every other
  // window. The main window is therefore told twice about its own clears
  // (once via onCleared, once via the event); markRetainedCleared is
  // idempotent, so this is harmless.
  const notifyCleared = (topics: string[]) => {
    options.onCleared?.(topics);
    Events.Emit(RETAINED_CLEARED_EVENT, {
      connectionId,
      topics,
    } satisfies RetainedClearedEvent);
  };

  const requestClear = (topic: string) => {
    request.set({ topic, topics: [topic], count: 0, busy: false });
    isOpen.set(true);
  };

  const requestClearBelow = async (prefix: string) => {
    let topics: string[];
    try {
      topics = await GetRetainedTopicsUnderPrefix(connectionId, prefix);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to find retained messages",
          description: errorMessage(e),
          type: "error",
        },
      });
      return;
    }
    // The prefix itself may hold a retained message; the menu offers this
    // action for what is below, so clearing the branch must not silently take
    // the topic you right-clicked with it.
    const below = topics.filter((t) => t !== prefix);
    // The count on the menu item was fetched when the menu opened, so another
    // client can clear the lot in between. Say so: asking for three things and
    // getting silence reads as a broken button.
    if (below.length === 0) {
      addToast({
        data: {
          title: "Nothing left to clear",
          description: prefix,
          descriptionStyle: "code",
          type: "info",
        },
      });
      return;
    }
    // Capture the exact list now. The dialog's number is a promise about what
    // gets cleared, so it must not be re-resolved after the user agrees to it.
    request.set({
      topic: prefix,
      topics: below,
      count: below.length,
      busy: false,
    });
    isOpen.set(true);
  };

  const confirm = async () => {
    const { topics, topic: prefix, count } = get(request);
    request.update((r) => ({ ...r, busy: true }));
    try {
      if (count === 0) {
        await DeleteRetainedMessage(connectionId, topics[0]);
        notifyCleared(topics);
        addToast({
          data: {
            title: "Retained message cleared",
            description: topics[0],
            descriptionStyle: "code",
            type: "success",
          },
        });
      } else {
        // The counts come back from attempted publishes, not from the length
        // of the list I handed over, so the number reported is the number that
        // actually went.
        const result = await DeleteRetainedMessages(connectionId, topics);
        if (result.cleared > 0) notifyCleared(topics);
        const attempted = result.cleared + result.failed;
        if (result.failed === 0) {
          addToast({
            data: {
              title: `${result.cleared} retained ${
                result.cleared === 1 ? "message" : "messages"
              } cleared`,
              description: prefix,
              descriptionStyle: "code",
              type: "success",
            },
          });
        } else {
          addToast({
            data: {
              title: `Cleared ${result.cleared} of ${attempted} retained messages`,
              description: result.firstError,
              descriptionStyle: "code",
              type: "error",
            },
          });
        }
      }
    } catch (e) {
      addToast({
        data: {
          title: "Failed to clear retained messages",
          description: errorMessage(e),
          type: "error",
        },
      });
    } finally {
      request.update((r) => ({ ...r, busy: false }));
      isOpen.set(false);
    }
  };

  return {
    isOpen,
    request: { subscribe: request.subscribe },
    requestClear,
    requestClearBelow,
    confirm,
  };
};
