import { derived } from "svelte/store";
import subscriptions from "../subscriptions";
import connectionProtobufDetailsMap from "./connection-protobuf-details-by-id.js";

export interface SubscriptionMissingProtoDescriptorError {
  byConnId: Set<number>;
  bySubId: Set<number>;
}

const missingProtoDescriptorErrors = derived(
  [subscriptions, connectionProtobufDetailsMap],
  ([$subscriptions, $connectionProtobufDetailsMap]) => {
    const result: SubscriptionMissingProtoDescriptorError = {
      byConnId: new Set<number>(),
      bySubId: new Set<number>(),
    };
    try {
      Object.keys($subscriptions.subscriptionsByConnectionId).forEach((id) => {
        const connId = Number(id);
        const connProtoDetails = $connectionProtobufDetailsMap[Number(connId)];
        if (!connProtoDetails?.protoLoaded) return;
        const loadedDescriptors = new Set(
          connProtoDetails.loadedDescriptorNames
        );
        const subscriptions =
          $subscriptions.subscriptionsByConnectionId[connId];
        for (const subscription of subscriptions) {
          if (!!subscription.protoDescriptor) {
            const isMissingDescriptor = !loadedDescriptors.has(
              subscription.protoDescriptor
            );
            if (isMissingDescriptor) {
              result.byConnId.add(connId);
              result.bySubId.add(subscription.id);
            }
          }
        }
      });
      return result;
    } catch (e) {
      console.error(e);
      return result;
    }
  }
);

export default missingProtoDescriptorErrors;
