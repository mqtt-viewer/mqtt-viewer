import * as generated from "../../../bindings/mqtt-viewer/backend/app/app";
import type { app } from "../models";

export const AddSubscription = generated.AddSubscription;
export const CheckForUpdates = generated.CheckForUpdates;
export const ChooseCertFile = generated.ChooseCertFile;
export const ChooseDirectory = generated.ChooseDirectory;
export const ClearConnectionHistory = generated.ClearConnectionHistory;
export const ConnectMqtt = generated.ConnectMqtt;
export const DeleteConnection = generated.DeleteConnection;
export const DeleteFilterHistoryEntry = generated.DeleteFilterHistoryEntry;
export const DeletePublishHistoryEntry = generated.DeletePublishHistoryEntry;
export const DeleteRetainedMessage = generated.DeleteRetainedMessage;
export const DeleteSubscription = generated.DeleteSubscription;
export const DisconnectMqtt = generated.DisconnectMqtt;
export const GetAllSubscriptionsByConnectionId = generated.GetAllSubscriptionsByConnectionId;
export const GetEnvInfo = generated.GetEnvInfo;
export const GetFilterHistoriesForConnection = generated.GetFilterHistoriesForConnection;
export const GetMatchingSubscriptionForTopic = generated.GetMatchingSubscriptionForTopic;
export const GetMessageHistory = generated.GetMessageHistory;
export const GetPanelSizes = generated.GetPanelSizes;
export const GetPublishHistoriesForConnection = generated.GetPublishHistoriesForConnection;
export const GetSortStates = generated.GetSortStates;
export const LoadOpenTabs = generated.LoadOpenTabs;
export const NewConnection = generated.NewConnection;
export const PublishMqtt = generated.PublishMqtt;
export const SaveFilterHistoryEntry = generated.SaveFilterHistoryEntry;
export const SavePublishHistoryEntry = generated.SavePublishHistoryEntry;
export const StartUpdate = generated.StartUpdate;
export const Startup = generated.Startup;
export const UpdateConnection = generated.UpdateConnection;
export const UpdateOpenConnectionTabs = generated.UpdateOpenConnectionTabs;
export const UpdatePanelSize = generated.UpdatePanelSize;
export const UpdateSortState = generated.UpdateSortState;
export const UpdateSubscription = generated.UpdateSubscription;

export function GetAllConnections(): Promise<app.Connections> {
  return generated.GetAllConnections() as unknown as Promise<app.Connections>;
}

export function GetMqttStats(): Promise<app.MqttStats> {
  return generated.GetMqttStats() as unknown as Promise<app.MqttStats>;
}
