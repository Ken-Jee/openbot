import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the settings context reaches in main: the app-wide preferences, the switches for updates,
 * notifications and the Dynamic Island, and the local agents of the Agents tab.
 */
export interface SettingsPort {
  getAgentDefaults: OpenBotDesktopApi["getAgentDefaults"];
  getAgentMemoryLimitPreference: OpenBotDesktopApi["getAgentMemoryLimitPreference"];
  getAnalyticsPreference: OpenBotDesktopApi["getAnalyticsPreference"];
  getAppBehaviorPreference: OpenBotDesktopApi["getAppBehaviorPreference"];
  getApprovalAutomation: OpenBotDesktopApi["getApprovalAutomation"];
  getBusyMessageModePreference: OpenBotDesktopApi["getBusyMessageModePreference"];
  getRemoteNetworkRoute: OpenBotDesktopApi["getRemoteNetworkRoute"];
  getRemoteSessionReusePreference: OpenBotDesktopApi["getRemoteSessionReusePreference"];
  onAgentMemoryLimitPreference: OpenBotDesktopApi["onAgentMemoryLimitPreference"];
  onApprovalAutomation: OpenBotDesktopApi["onApprovalAutomation"];
  onOpenSettings: OpenBotDesktopApi["onOpenSettings"];
  setAgentDefaults: OpenBotDesktopApi["setAgentDefaults"];
  setAnalyticsPreference: OpenBotDesktopApi["setAnalyticsPreference"];
  setAppBehaviorPreference: OpenBotDesktopApi["setAppBehaviorPreference"];
  setBusyMessageModePreference: OpenBotDesktopApi["setBusyMessageModePreference"];
  setRemoteNetworkRoute: OpenBotDesktopApi["setRemoteNetworkRoute"];
  setRemoteSessionReusePreference: OpenBotDesktopApi["setRemoteSessionReusePreference"];
  agent: Pick<OpenBotDesktopApi["agent"], "listAgents" | "updateAgent">;
  dynamicIsland: Pick<
    OpenBotDesktopApi["dynamicIsland"],
    "getBuiltInDisplayGeometry" | "getPreference" | "setPreference"
  >;
  notifications: Pick<OpenBotDesktopApi["notifications"], "getPreference" | "openSettings" | "setPreference" | "test">;
  update: Pick<OpenBotDesktopApi["update"], "getPreference" | "onPreference" | "setPreference">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function settingsPort(): SettingsPort {
  return window.openbot;
}
