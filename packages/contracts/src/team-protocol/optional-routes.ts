import { ACP_REGISTRY_CODECS } from "./acp-registry-v1";
// The optional admin routes, one table. `teamSideRouteCodec` in `side-routes.ts` asks here, so every
// HTTP and WebRTC transport encodes an admin route with its frozen codec. A path that is not listed
// goes to the protocol adapter.
import type { OptionalRouteCodec } from "./admin-wire";
import { AGENT_ADMIN_CODECS } from "./agent-admin-v1";
import { AGENT_HIDDEN_CODECS } from "./agent-hidden-v1";
import { AGENT_HOST_SETTINGS_CODECS } from "./agent-host-settings-v1";
import { AGENT_IMPORT_CODECS } from "./agent-import-v1";
import { AGENT_INSTALL_CODECS } from "./agent-install-v1";
import { AGENT_MEMORIES_CODECS } from "./agent-memories-v1";
import { AGENT_MEMORY_LIMIT_CODECS } from "./agent-memory-limit-v1";
import { AGENT_PUBLISH_CODECS } from "./agent-publish-v1";
import { AGENT_SESSION_SETTINGS_CODECS } from "./agent-session-settings-v1";
import { AGENT_TASKS_CODECS } from "./agent-tasks-v1";
import { AGENT_UPDATE_CODECS } from "./agent-update-v1";
import { BROWSER_PAGE_STATE_CODECS } from "./browser-page-state-v1";
import { BROWSER_USER_CONTROL_CODECS } from "./browser-user-control-v1";
import { CONNECTORS_CODECS } from "./connectors-v1";
import { CONTEXT_RESET_CODECS } from "./context-reset-v1";
import { CONVERSATION_FILE_SEARCH_CODECS } from "./conversation-file-search-v1";
import { DISCORD_ACCESS_CODECS } from "./discord-access-v1";
import { EVENTS_CODECS } from "./events-v1";
import { FOCUS_USE_CODECS } from "./focus-use-v1";
import { HOST_ADMIN_CODECS } from "./host-admin-v1";
import { HOST_MEMBER_UPDATE_CODECS } from "./host-member-update-v1";
import { HOST_RELEASE_CODECS } from "./host-release-v1";
import { HOST_TIMEZONE_CODECS } from "./host-timezone-v1";
import { HOST_UPDATE_CODECS } from "./host-update-v1";
import { HOSTED_SITES_CODECS } from "./hosted-sites-v1";
import { INSTANCE_TRANSFER_CODECS } from "./instance-transfer-v1";
import { LIVE_ACTIVITY_PUSH_CODECS } from "./live-activity-push-v1";
import { MCP_SIGN_IN_APP_CODECS } from "./mcp-sign-in-app-v1";
import { MCP_SIGN_IN_CODECS } from "./mcp-sign-in-v1";
import { ONEPASSWORD_CONNECTOR_CODECS } from "./onepassword-connector-v1";
import { PROVIDER_ACCOUNTS_CODECS } from "./provider-accounts-v1";
import { PROVIDER_HOST_SIGN_IN_CODECS } from "./provider-host-sign-in-v1";
import { PROVIDERS_ADMIN_CODECS } from "./providers-v1";
import { PROVIDERS_RUNTIMES_V2_CODECS } from "./providers-v2";
import { PROVIDERS_SIGN_IN_V3_CODECS } from "./providers-v3";
import { PROVIDERS_V4_CODECS } from "./providers-v4";
import { PROVIDERS_V5_CODECS } from "./providers-v5";
import { ANDROID_PUSH_NOTIFICATIONS_CODECS } from "./push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_CODECS } from "./push-notifications-v1";
import { ROUTINE_FLOWS_CODECS } from "./routine-flows-v1";
import { ROUTINE_RECOVERY_CODECS } from "./routine-recovery-v1";
import { SHARED_TABLES_CODECS } from "./shared-tables-v1";
import { SIGN_IN_RELAY_CODECS } from "./sign-in-relay-v1";
import { SKILLS_ADMIN_CODECS } from "./skills-admin-v1";
import { WORKSPACE_DIRECTORY_CODECS } from "./workspace-directory-v1";

export type { OptionalRouteCodec } from "./admin-wire";

const CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  ...AGENT_ADMIN_CODECS,
  ...AGENT_MEMORIES_CODECS,
  ...SKILLS_ADMIN_CODECS,
  ...SHARED_TABLES_CODECS,
  ...AGENT_INSTALL_CODECS,
  ...AGENT_UPDATE_CODECS,
  ...PROVIDERS_ADMIN_CODECS,
  ...PROVIDERS_RUNTIMES_V2_CODECS,
  ...PROVIDERS_SIGN_IN_V3_CODECS,
  ...PROVIDERS_V4_CODECS,
  ...PROVIDERS_V5_CODECS,
  ...AGENT_SESSION_SETTINGS_CODECS,
  ...ACP_REGISTRY_CODECS,
  ...HOST_ADMIN_CODECS,
  ...HOST_UPDATE_CODECS,
  ...HOST_TIMEZONE_CODECS,
  ...AGENT_MEMORY_LIMIT_CODECS,
  ...DISCORD_ACCESS_CODECS,
  ...HOST_RELEASE_CODECS,
  ...HOST_MEMBER_UPDATE_CODECS,
  ...CONTEXT_RESET_CODECS,
  ...EVENTS_CODECS,
  ...AGENT_IMPORT_CODECS,
  ...INSTANCE_TRANSFER_CODECS,
  ...AGENT_PUBLISH_CODECS,
  ...LIVE_ACTIVITY_PUSH_CODECS,
  ...PUSH_NOTIFICATIONS_CODECS,
  ...ANDROID_PUSH_NOTIFICATIONS_CODECS,
  ...HOSTED_SITES_CODECS,
  ...WORKSPACE_DIRECTORY_CODECS,
  ...AGENT_HOST_SETTINGS_CODECS,
  ...MCP_SIGN_IN_CODECS,
  ...PROVIDER_HOST_SIGN_IN_CODECS,
  ...MCP_SIGN_IN_APP_CODECS,
  ...SIGN_IN_RELAY_CODECS,
  ...FOCUS_USE_CODECS,
  ...CONNECTORS_CODECS,
  ...CONVERSATION_FILE_SEARCH_CODECS,
  ...ROUTINE_FLOWS_CODECS,
  ...ROUTINE_RECOVERY_CODECS,
  ...PROVIDER_ACCOUNTS_CODECS,
  ...ONEPASSWORD_CONNECTOR_CODECS,
  ...AGENT_HIDDEN_CODECS,
  ...BROWSER_USER_CONTROL_CODECS,
  ...BROWSER_PAGE_STATE_CODECS,
  ...AGENT_TASKS_CODECS,
]);

export function optionalRouteCodec(path: string): OptionalRouteCodec | undefined {
  return CODECS.get(new URL(path, "http://openbot.invalid").pathname);
}
