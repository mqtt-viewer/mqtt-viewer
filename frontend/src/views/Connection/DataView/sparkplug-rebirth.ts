import { get, writable, type Readable, type Writable } from "svelte/store";
import { PublishSparkplugRebirth } from "bindings/mqtt-viewer/backend/app/app";
import { addToast } from "@/components/Toast/Toast.svelte";
import { errorMessage } from "@/util/strings";

export interface RebirthTarget {
  group: string;
  node: string;
}

export interface RebirthRequest {
  targets: RebirthTarget[];
  busy: boolean;
}

export interface RebirthFlow {
  isOpen: Writable<boolean>;
  request: Readable<RebirthRequest>;
  /** Opens the confirmation for one or more edge nodes. */
  requestRebirth: (targets: RebirthTarget[]) => void;
  confirm: () => Promise<void>;
}

export const rebirthTopic = (t: RebirthTarget) => `spBv1.0/${t.group}/NCMD/${t.node}`;

// A rebirth request publishes an NCMD to a live edge node, which then resends
// every birth certificate. Every host application on the broker sees those
// births, and on a busy plant network that is real traffic, so it is always
// confirmed and always reports the outcome. The caller renders the dialog
// from isOpen and request.
//
// Shared by the main window and the popped-out topic window, which is a
// separate webview and so cannot reach the main window's dialog.
export const createRebirthFlow = (connectionId: number): RebirthFlow => {
  const isOpen = writable(false);
  const request = writable<RebirthRequest>({ targets: [], busy: false });

  const requestRebirth = (targets: RebirthTarget[]) => {
    if (targets.length === 0) return;
    request.set({ targets, busy: false });
    isOpen.set(true);
  };

  const confirm = async () => {
    const { targets } = get(request);
    request.update((r) => ({ ...r, busy: true }));
    let sent = 0;
    let firstError: string | null = null;
    // One at a time: each is a single QoS 0 publish, so this is quick, and a
    // failure part way through still reports how far it got.
    for (const target of targets) {
      try {
        await PublishSparkplugRebirth(connectionId, target.group, target.node);
        sent++;
      } catch (e) {
        firstError ??= errorMessage(e);
      }
    }
    if (firstError === null) {
      addToast({
        data: {
          title: sent === 1 ? "Rebirth requested" : `${sent} rebirths requested`,
          description:
            sent === 1 ? `${targets[0].group}/${targets[0].node}` : "Names update as the births arrive.",
          descriptionStyle: sent === 1 ? "code" : "text",
          type: "success",
        },
      });
    } else {
      addToast({
        data: {
          title:
            targets.length === 1
              ? "Rebirth request failed"
              : `Requested ${sent} of ${targets.length} rebirths`,
          description: firstError,
          type: "error",
        },
      });
    }
    request.update((r) => ({ ...r, busy: false }));
    isOpen.set(false);
  };

  return {
    isOpen,
    request: { subscribe: request.subscribe },
    requestRebirth,
    confirm,
  };
};
