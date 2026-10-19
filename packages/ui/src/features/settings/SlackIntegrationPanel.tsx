import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  MessagingConnection,
  MessagingPlatform,
  MessagingRole,
} from "@openbot/contracts/ipc";
import { MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import type { AppMessages, AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
  Checkbox,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2Off,
  SettingsSection,
  Spinner,
  Text,
  Trash2,
  TriangleAlert,
} from "@openbot/ui";
import { createEffect, createSignal, createStore, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { DiscordMark, SlackMark } from "./brand-marks";
import {
  DetailHeader,
  type IntegrationStatus,
  LogoTile,
  ReadFailedAlert,
  Stepper,
  UNKNOWN_STATUS,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import type { IntegrationAgent } from "./IntegrationsHub";

export type SlackIntegrationAgent = IntegrationAgent & { title: string };

/** The model of the Slack Orchestrator that the user picks in the connect dialog. */
export interface SlackOrchestratorChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export interface SlackOrchestratorModels {
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  initial: SlackOrchestratorChoice | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
}

/** Who can use OpenBot in each Discord server: the members with one of the saved roles. */
export interface DiscordAccessControl {
  /** The saved roles of a Discord server. Empty lets everyone; null while they are not known. */
  allowed: (workspaceId: string) => readonly MessagingRole[] | null;
  /** The roles of a Discord server to choose from. Rejects with the reason. */
  loadRoles: (workspaceId: string) => Promise<readonly MessagingRole[]>;
  onSave: (workspaceId: string, roles: MessagingRole[]) => void;
  /** True when the joined server's OpenBot is too old to choose roles. */
  unsupported?: boolean | undefined;
}

export interface SlackIntegrationPanelProps {
  /** Slack when absent. Discord shows the same page with its own text, logo and orchestrator. */
  platform?: WorkspacePlatform | undefined;
  /** Every agent on this computer. */
  agents: SlackIntegrationAgent[];
  /** The connected workspaces: Slack workspaces or Discord servers. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onDisconnectWorkspace: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  /** The joined server's name, when the connections are that server's and not this computer's. */
  hostName?: string | undefined;
  /**
   * Why the last read of the connections failed. `connections` are from an earlier read; with none,
   * the state is not known, so the page shows the reason and Retry and offers no connect.
   */
  loadError?: string | null | undefined;
  /** Reads the connections again. */
  onRetry?: (() => void) | undefined;
  /** Who can use OpenBot in each Discord server. Discord only. */
  access?: DiscordAccessControl | undefined;
}

/** What a workspace row can do. */
type RowKind = "live" | "setup" | "paused" | "attention";

function rowKind(connection: MessagingConnection): RowKind {
  switch (connection.state) {
    case "connected":
      return "live";
    case "paused":
      return "paused";
    case "connecting":
    case "reconnecting":
    case "rate_limited":
      return "setup";
    default:
      return "attention";
  }
}

/** The platforms that this page serves. Telegram has its own page (`TelegramIntegrationPanel`). */
export type WorkspacePlatform = Exclude<MessagingPlatform, "telegram">;

const STATE_HELP: Record<WorkspacePlatform, Partial<Record<MessagingConnection["state"], AppTextKey>>> = {
  slack: {
    invalid_token: "messaging.help.invalid_token",
    secret_storage_unavailable: "messaging.help.secret_storage_unavailable",
    relay_unavailable: "messaging.help.relay_unavailable",
  },
  discord: {
    invalid_token: "messaging.discordHelp.invalid_token",
    secret_storage_unavailable: "messaging.discordHelp.secret_storage_unavailable",
    relay_unavailable: "messaging.discordHelp.relay_unavailable",
  },
};

const SLACK_TEXT = {
  title: "connector.slack.title",
  description: "connector.slack.description",
  statusNotSetUp: "connector.slack.statusNotSetUp",
  statusConnected: "connector.slack.statusConnected",
  statusAttention: "connector.slack.statusAttention",
  summaryConnected: "connector.slack.summaryConnected",
  summaryNoAgent: "connector.slack.summaryNoAgent",
  attentionTitle: "connector.slack.attentionTitle",
  attentionDescription: "connector.slack.attentionDescription",
  connect: "connector.slack.connect",
  addAgent: "connector.slack.addAgent",
  workspaceTitle: "connector.slack.workspaceTitle",
  workspaceDescription: "connector.slack.workspaceDescription",
  disconnectWorkspace: "connector.slack.disconnectWorkspace",
  missingScopes: "connector.slack.missingScopes",
  retryAt: "connector.slack.retryAt",
  reconnect: "connector.slack.reconnect",
  pause: "connector.slack.pause",
  resume: "connector.slack.resume",
  rowAction: "connector.slack.rowAction",
  orchestratorTitle: "connector.slack.orchestratorTitle",
  orchestratorDescription: "connector.slack.orchestratorDescription",
  orchestratorNone: "connector.slack.orchestratorNone",
  orchestratorNoneDescription: "connector.slack.orchestratorNoneDescription",
  note: "connector.slack.inviteNote",
  stepWorkspace: "connector.slack.stepWorkspace",
  stepAgent: "connector.slack.stepAgent",
  connectTitle: "connector.slack.connectTitle",
  connectDescription: "connector.slack.connectDescription",
  connectStepBrowser: "connector.slack.connectStepBrowser",
  connectStepAllow: "connector.slack.connectStepAllow",
  connectStepReturn: "connector.slack.connectStepReturn",
  connectInApp: "connector.slack.connectInSlack",
  connectWaiting: "connector.slack.connectWaiting",
  agentStepTitle: "connector.slack.agentStepTitle",
  agentStepDescription: "connector.slack.agentStepDescription",
  orchestratorName: "connector.slack.orchestratorName",
  orchestratorRole: "connector.slack.orchestratorRole",
  orchestratorDoesReceive: "connector.slack.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.slack.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.slack.orchestratorDoesAnswer",
  orchestratorModel: "connector.slack.orchestratorModel",
  doneTitle: "connector.slack.doneTitle",
  doneDescription: "connector.slack.doneDescription",
  done: "connector.slack.done",
  disconnectTitle: "connector.slack.disconnectTitle",
  disconnectDescription: "connector.slack.disconnectDescription",
  disconnectDescriptionHost: "connector.slack.disconnectDescriptionHost",
  disconnectEffect: "connector.slack.disconnectEffect",
  removeEffectKept: "connector.slack.removeEffectKept",
  removeEffectDeleted: "connector.slack.removeEffectDeleted",
  keep: "connector.slack.keep",
  close: "connector.slack.close",
  addWorkspace: "connector.slack.addWorkspace",
  limitReached: "connector.slack.limitReached",
  orchestratorTitleFor: "connector.slack.orchestratorTitleFor",
  summaryMany: "connector.slack.summaryMany",
} as const satisfies Record<string, keyof AppMessages>;

const DISCORD_TEXT = {
  title: "connector.discord.title",
  description: "connector.discord.description",
  statusNotSetUp: "connector.discord.statusNotSetUp",
  statusConnected: "connector.discord.statusConnected",
  statusAttention: "connector.discord.statusAttention",
  summaryConnected: "connector.discord.summaryConnected",
  summaryNoAgent: "connector.discord.summaryNoAgent",
  attentionTitle: "connector.discord.attentionTitle",
  attentionDescription: "connector.discord.attentionDescription",
  connect: "connector.discord.connect",
  addAgent: "connector.discord.addAgent",
  workspaceTitle: "connector.discord.workspaceTitle",
  workspaceDescription: "connector.discord.workspaceDescription",
  disconnectWorkspace: "connector.discord.disconnectWorkspace",
  missingScopes: "connector.discord.missingScopes",
  retryAt: "connector.discord.retryAt",
  reconnect: "connector.discord.reconnect",
  pause: "connector.discord.pause",
  resume: "connector.discord.resume",
  rowAction: "connector.discord.rowAction",
  orchestratorTitle: "connector.discord.orchestratorTitle",
  orchestratorDescription: "connector.discord.orchestratorDescription",
  orchestratorNone: "connector.discord.orchestratorNone",
  orchestratorNoneDescription: "connector.discord.orchestratorNoneDescription",
  note: "connector.discord.channelsNote",
  stepWorkspace: "connector.discord.stepWorkspace",
  stepAgent: "connector.discord.stepAgent",
  connectTitle: "connector.discord.connectTitle",
  connectDescription: "connector.discord.connectDescription",
  connectStepBrowser: "connector.discord.connectStepBrowser",
  connectStepAllow: "connector.discord.connectStepAllow",
  connectStepReturn: "connector.discord.connectStepReturn",
  connectInApp: "connector.discord.connectInDiscord",
  connectWaiting: "connector.discord.connectWaiting",
  agentStepTitle: "connector.discord.agentStepTitle",
  agentStepDescription: "connector.discord.agentStepDescription",
  orchestratorName: "connector.discord.orchestratorName",
  orchestratorRole: "connector.discord.orchestratorRole",
  orchestratorDoesReceive: "connector.discord.orchestratorDoesReceive",
  orchestratorDoesDelegate: "connector.discord.orchestratorDoesDelegate",
  orchestratorDoesAnswer: "connector.discord.orchestratorDoesAnswer",
  orchestratorModel: "connector.discord.orchestratorModel",
  doneTitle: "connector.discord.doneTitle",
  doneDescription: "connector.discord.doneDescription",
  done: "connector.discord.done",
  disconnectTitle: "connector.discord.disconnectTitle",
  disconnectDescription: "connector.discord.disconnectDescription",
  disconnectDescriptionHost: "connector.discord.disconnectDescriptionHost",
  disconnectEffect: "connector.discord.disconnectEffect",
  removeEffectKept: "connector.discord.removeEffectKept",
  removeEffectDeleted: "connector.discord.removeEffectDeleted",
  keep: "connector.discord.keep",
  close: "connector.discord.close",
  addWorkspace: "connector.discord.addWorkspace",
  limitReached: "connector.discord.limitReached",
  orchestratorTitleFor: "connector.discord.orchestratorTitleFor",
  summaryMany: "connector.discord.summaryMany",
} as const satisfies Record<keyof typeof SLACK_TEXT, keyof AppMessages>;

/** The catalog keys of a platform's page. The Connectors list reads the title and summaries too. */
export function messagingPlatformText(platform: WorkspacePlatform = "slack") {
  return platform === "discord" ? DISCORD_TEXT : SLACK_TEXT;
}

const ORCHESTRATOR_AVATAR = {
  slack: SLACK_ORCHESTRATOR_AVATAR,
  discord: DISCORD_ORCHESTRATOR_AVATAR,
} as const satisfies Record<WorkspacePlatform, { avatarSeed: string; avatarHue: number }>;

/** The logo of a platform. */
export function MessagingMark(props: { platform?: WorkspacePlatform | undefined }) {
  return (
    <Show when={props.platform === "discord"} fallback={<SlackMark />}>
      <DiscordMark />
    </Show>
  );
}

/** The orchestrator agent of a workspace, when it still exists. */
export function slackOrchestrator<Agent extends { id: string }>(
  connection: MessagingConnection,
  agents: readonly Agent[],
): Agent | null {
  return agents.find((agent) => agent.id === connection.orchestratorAgentId) ?? null;
}

/**
 * True when a read of the connections failed and no earlier read gave any. The state is not known, and
 * "Not set up" would be wrong. Telegram's page uses it too.
 */
export function messagingStateUnknown(props: {
  connections: readonly MessagingConnection[];
  loadError?: string | null | undefined;
}): boolean {
  return Boolean(props.loadError) && props.connections.length === 0;
}

/** The state of the whole Slack or Discord integration, for the page header and the Connectors list. */
export function slackIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  platform: WorkspacePlatform = "slack",
  loadError?: string | null,
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const text = messagingPlatformText(platform);
  const attention = connections.filter(
    (connection) => rowKind(connection) === "attention" || !slackOrchestrator(connection, agents),
  ).length;
  if (attention > 0) return { status: "attention", label: text.statusAttention, attention };
  if (connections.length === 0) return { status: "idle", label: text.statusNotSetUp, attention };
  return { status: "connected", label: text.statusConnected, attention };
}

/**
 * The workspace that the connect dialog follows. A new one is the first connection that was not there
 * when the dialog opened; until it comes back from the browser, the dialog shows the connect step.
 */
type DialogTarget = { kind: "new"; before: ReadonlySet<string> } | { kind: "existing"; workspaceId: string };

/**
 * Server settings > Connectors > Slack. A workspace installs the one OpenBot app, and its Slack
 * Orchestrator agent receives every request, asks the team and answers. The connect dialog does both
 * steps. No token reaches this component. Server settings > Connectors > Discord is the same page
 * for a Discord server, with `platform` "discord".
 */
export function SlackIntegrationPanel(props: SlackIntegrationPanelProps) {
  const { t } = useText();
  const [target, setTarget] = createSignal<DialogTarget | null>(null);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  const [choosingRoles, setChoosingRoles] = createSignal<MessagingConnection | null>(null);
  const text = () => messagingPlatformText(props.platform);
  const state = () => slackIntegrationState(props.connections, props.agents, props.platform, props.loadError);
  const unknown = () => messagingStateUnknown(props);
  const access = () => (props.platform === "discord" ? props.access : undefined);
  /** The first workspace with no orchestrator: the header offers the next step of its dialog. */
  const needsAgent = () => props.connections.find((connection) => !slackOrchestrator(connection, props.agents)) ?? null;
  const atLimit = () => props.connections.length >= MESSAGING_LIMITS.connections;
  const openNew = () =>
    setTarget({ kind: "new", before: new Set(props.connections.map((connection) => connection.workspaceId)) });
  const dialogConnection = () => {
    const current = target();
    if (!current) return null;
    const found =
      current.kind === "existing"
        ? props.connections.find((connection) => connection.workspaceId === current.workspaceId)
        : props.connections.find((connection) => !current.before.has(connection.workspaceId));
    return found ?? null;
  };
  /** A disconnect deletes the workspace's orchestrator. */
  const disconnectDeletesOrchestrator = () => {
    const connection = disconnecting();
    return connection !== null && slackOrchestrator(connection, props.agents) !== null;
  };

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<MessagingMark platform={props.platform} />}
        name={t(text().title)}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t(text().description)}
        actions={
          <Show when={!unknown()}>
            <Switch
              fallback={
                <Button type="button" size="sm" disabled={props.busy || atLimit()} onClick={openNew}>
                  {t(text().addWorkspace)}
                </Button>
              }
            >
              <Match when={props.connections.length === 0}>
                <Button type="button" size="sm" disabled={props.busy} onClick={openNew}>
                  {t(text().connect)}
                </Button>
              </Match>
              <Match when={needsAgent()}>
                {(connection) => (
                  <Button
                    type="button"
                    size="sm"
                    disabled={props.busy}
                    onClick={() => setTarget({ kind: "existing", workspaceId: connection().workspaceId })}
                  >
                    {t(text().addAgent)}
                  </Button>
                )}
              </Match>
            </Switch>
          </Show>
        }
      />

      <Show when={props.loadError}>{(message) => <ReadFailedAlert message={message()} onRetry={props.onRetry} />}</Show>

      <Show when={state().attention > 0}>
        <Alert tone="warning" role="alert">
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>{t(text().attentionTitle, { count: state().attention })}</AlertTitle>
            <AlertDescription>{t(text().attentionDescription)}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      {/* Not set up, the header holds the only step: Connect Slack. */}
      <Show when={props.connections.length > 0}>
        <SettingsSection title={t(text().workspaceTitle)}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
              {(connection) => (
                <WorkspaceRow
                  platform={props.platform}
                  connection={connection}
                  busy={props.busy}
                  onReconnect={() => props.onReconnect(connection.workspaceId)}
                  onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                  onDisconnect={() => setDisconnecting(connection)}
                />
              )}
            </For>
          </ItemGroup>
          <Show when={atLimit()}>
            <Text class="slack-integration-note" variant="caption" tone="muted">
              {t(text().limitReached, { count: MESSAGING_LIMITS.connections })}
            </Text>
          </Show>
        </SettingsSection>
      </Show>

      <For each={props.connections}>
        {(connection) => (
          <>
            <SettingsSection
              title={
                props.connections.length > 1
                  ? t(text().orchestratorTitleFor, { workspace: connection.workspaceName })
                  : t(text().orchestratorTitle)
              }
              description={t(text().orchestratorDescription)}
            >
              <ItemGroup class="settings-modal-card">
                <Show
                  when={slackOrchestrator(connection, props.agents)}
                  fallback={
                    <Item class="settings-modal-row">
                      <ItemMedia>
                        <OrchestratorFace platform={props.platform} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t(text().orchestratorNone)}</ItemTitle>
                        <ItemDescription>{t(text().orchestratorNoneDescription)}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          size="sm"
                          disabled={props.busy}
                          onClick={() => setTarget({ kind: "existing", workspaceId: connection.workspaceId })}
                        >
                          {t(text().addAgent)}
                        </Button>
                      </ItemActions>
                    </Item>
                  }
                >
                  {(agent) => (
                    <Item class="settings-modal-row">
                      <ItemMedia>
                        <span class="integrations-agent-face" data-size="md">
                          <AgentAvatar agent={agent()} motion="idle" />
                        </span>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{agent().name}</ItemTitle>
                        <ItemDescription>{agent().title}</ItemDescription>
                      </ItemContent>
                    </Item>
                  )}
                </Show>
              </ItemGroup>
              <Text class="slack-integration-note" variant="caption" tone="muted">
                {t(text().note)}
              </Text>
            </SettingsSection>
            <Show when={access()}>
              {(control) => (
                <SettingsSection
                  title={t("connector.discord.accessTitle")}
                  description={t("connector.discord.accessDescription")}
                >
                  <ItemGroup class="settings-modal-card">
                    <AccessRow
                      connection={connection}
                      access={control()}
                      hostName={props.hostName}
                      busy={props.busy}
                      onChoose={() => setChoosingRoles(connection)}
                    />
                  </ItemGroup>
                </SettingsSection>
              )}
            </Show>
          </>
        )}
      </For>

      <SlackConnectDialog
        platform={props.platform}
        open={target() !== null}
        connection={dialogConnection()}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectWorkspace={props.onConnectWorkspace}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setTarget(null)}
      />
      <Show when={access()}>
        {(control) => (
          <RolesDialog
            connection={choosingRoles()}
            access={control()}
            busy={props.busy}
            onClose={() => setChoosingRoles(null)}
          />
        )}
      </Show>
      <DisconnectDialog
        platform={props.platform}
        hostName={props.hostName}
        connection={disconnecting()}
        deletesOrchestrator={disconnectDeletesOrchestrator()}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectWorkspace(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  );
}

function OrchestratorFace(props: { platform?: WorkspacePlatform | undefined; size?: "md" | "lg" }) {
  const avatar = () => ORCHESTRATOR_AVATAR[props.platform ?? "slack"];
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar seed={avatar().avatarSeed} hue={avatar().avatarHue} motion="idle" />
    </span>
  );
}

function WorkspaceRow(props: {
  platform?: WorkspacePlatform | undefined;
  connection: MessagingConnection;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const text = () => messagingPlatformText(props.platform);
  const kind = () => rowKind(props.connection);
  const note = () => {
    const current = props.connection;
    if (current.missingScopes.length > 0)
      return t(text().missingScopes, { scopes: format.list(current.missingScopes) });
    if (current.retryAt)
      return t(text().retryAt, {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    const help = STATE_HELP[props.platform ?? "slack"][current.state];
    return help ? t(help) : t(text().workspaceDescription);
  };
  const label = (action: string) => t(text().rowAction, { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <MessagingMark platform={props.platform} />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          <Match when={kind() === "attention"}>{action(t(text().reconnect), props.onReconnect)}</Match>
          <Match when={kind() === "paused"}>{action(t(text().resume), () => props.onSetEnabled(true))}</Match>
          <Match when={kind() === "live"}>{action(t(text().pause), () => props.onSetEnabled(false))}</Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t(text().disconnectWorkspace))}
          onClick={props.onDisconnect}
        >
          {t(text().disconnectWorkspace)}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Who can mention OpenBot in one Discord server, and the button that changes it. */
function AccessRow(props: {
  connection: MessagingConnection;
  access: DiscordAccessControl;
  hostName?: string | undefined;
  busy: boolean;
  onChoose: () => void;
}) {
  const { t, format } = useText();
  const allowed = () => props.access.allowed(props.connection.workspaceId);
  // A host that cannot choose roles lets everyone mention OpenBot.
  const everyone = () => props.access.unsupported === true || allowed()?.length === 0;
  const summary = () => {
    const roles = allowed();
    if (everyone()) return t("connector.discord.accessEveryone");
    if (roles === null) return t("connector.discord.accessLoading");
    return t("connector.discord.accessRoles", { roles: format.list(roles.map((role) => role.name)) });
  };
  const choose = () => t("connector.discord.accessChoose");
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{summary()}</ItemTitle>
        <Switch>
          <Match when={props.access.unsupported}>
            <ItemDescription>{t("connector.discord.accessHostUpdate", { host: props.hostName ?? "" })}</ItemDescription>
          </Match>
          <Match when={everyone()}>
            <ItemDescription>{t("connector.discord.accessEveryoneDescription")}</ItemDescription>
          </Match>
        </Switch>
      </ItemContent>
      <Show when={!props.access.unsupported}>
        <ItemActions>
          <Show when={allowed() === null}>
            <Spinner size="sm" />
          </Show>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy || allowed() === null}
            aria-label={t("connector.discord.rowAction", { action: choose(), name: props.connection.workspaceName })}
            onClick={props.onChoose}
          >
            {choose()}
          </Button>
        </ItemActions>
      </Show>
    </Item>
  );
}

/**
 * Chooses the roles whose members can use OpenBot in one Discord server. It reads the server's roles
 * when it opens. A saved role that the server no longer has stays in the list until the user removes it.
 */
function RolesDialog(props: {
  /** The Discord server; the dialog is open while it is set. */
  connection: MessagingConnection | null;
  access: DiscordAccessControl;
  busy: boolean;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const id = createUniqueId();
  const [view, setView] = createStore<{
    status: "loading" | "ready" | "failed";
    roles: MessagingRole[];
    /** The roles that were saved when the dialog opened. */
    saved: MessagingRole[];
    selected: string[];
    error: string;
  }>({ status: "loading", roles: [], saved: [], selected: [], error: "" });
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;
  const load = (workspaceId: string) => {
    const read = ++reads;
    setView((draft) => {
      draft.status = "loading";
      draft.error = "";
    });
    void props.access.loadRoles(workspaceId).then(
      (roles) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "ready";
          draft.roles = roles.map((role) => ({ ...role }));
        });
      },
      (error: unknown) => {
        if (read !== reads) return;
        setView((draft) => {
          draft.status = "failed";
          draft.error = errorMessage(error, t("connector.discord.accessLoadFailed"));
        });
      },
    );
  };
  createEffect(
    () => props.connection?.workspaceId,
    (workspaceId) => {
      reads += 1;
      if (!workspaceId) return;
      const saved = props.access.allowed(workspaceId) ?? [];
      setView((draft) => {
        draft.roles = [];
        draft.saved = saved.map((role) => ({ ...role }));
        draft.selected = saved.map((role) => role.id);
      });
      load(workspaceId);
    },
  );
  /** The server's roles, then the saved roles that the server no longer has. */
  const options = () => [
    ...view.roles.map((role) => ({ role, deleted: false })),
    ...view.saved
      .filter((role) => !view.roles.some((current) => current.id === role.id))
      .map((role) => ({ role, deleted: true })),
  ];
  const atCap = () => view.selected.length >= MESSAGING_LIMITS.allowedRoles;
  const toggle = (roleId: string, checked: boolean) =>
    setView((draft) => {
      draft.selected = checked
        ? [...draft.selected.filter((selected) => selected !== roleId), roleId]
        : draft.selected.filter((selected) => selected !== roleId);
    });
  const save = (workspaceId: string) => {
    const roles = options()
      .map((option) => option.role)
      .filter((role) => view.selected.includes(role.id))
      .map((role) => ({ id: role.id, name: role.name }));
    props.onClose();
    props.access.onSave(workspaceId, roles);
  };
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.discord.close")}
      onClose={props.onClose}
      logo={<DiscordMark />}
      link="connected"
      title={t("connector.discord.accessDialogTitle", { workspace: props.connection?.workspaceName ?? "" })}
      description={t("connector.discord.accessDialogDescription")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                disabled={view.status !== "ready" || props.busy}
                onClick={() => save(connection().workspaceId)}
              >
                {t("connector.discord.accessSave")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Switch
        fallback={
          <ul class="slack-roles" aria-label={t("connector.discord.accessTitle")}>
            <For each={options()}>
              {(option) => {
                const checked = () => view.selected.includes(option.role.id);
                return (
                  <li>
                    <label class="slack-role-row" for={`${id}-${option.role.id}`}>
                      <Checkbox
                        id={`${id}-${option.role.id}`}
                        checked={checked()}
                        disabled={!checked() && atCap()}
                        onChange={(event) => toggle(option.role.id, event.currentTarget.checked)}
                      />
                      <Text variant="body-sm" class="slack-role-name">
                        {option.deleted
                          ? t("connector.discord.accessRoleDeleted", { role: option.role.name })
                          : option.role.name}
                      </Text>
                    </label>
                  </li>
                );
              }}
            </For>
          </ul>
        }
      >
        <Match when={view.status === "loading"}>
          <div class="slack-waiting" aria-live="polite">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("connector.discord.accessLoading")}
            </Text>
          </div>
        </Match>
        <Match when={view.status === "failed"}>
          <ReadFailedAlert
            message={view.error}
            onRetry={() => {
              const workspaceId = props.connection?.workspaceId;
              if (workspaceId) load(workspaceId);
            }}
          />
        </Match>
        <Match when={options().length === 0}>
          <Text variant="body-sm" tone="muted" role="status">
            {t("connector.discord.accessNoRoles")}
          </Text>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

/** 0 connects the workspace, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Slack or Discord in two steps. Both end outside the dialog (the browser, then main), so
 * the step follows the first workspace's state: no workspace is step 1, a workspace with no
 * orchestrator is step 2, and one with an orchestrator is done.
 */
export function SlackConnectDialog(props: {
  /** Slack when absent. */
  platform?: WorkspacePlatform | undefined;
  open: boolean;
  connection: MessagingConnection | null;
  agents: readonly { id: string }[];
  busy: boolean;
  models?: SlackOrchestratorModels | undefined;
  onConnectWorkspace: () => void;
  onAddOrchestrator: (workspaceId: string, choice: SlackOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const text = () => messagingPlatformText(props.platform);
  const [waiting, setWaiting] = createSignal(false);
  const [choice, setChoice] = createSignal<SlackOrchestratorChoice | null>(null);
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setWaiting(false);
      setChoice(props.models?.initial ?? null);
    },
  );
  const step = (): ConnectStep => {
    const connection = props.connection;
    if (!connection) return 0;
    return slackOrchestrator(connection, props.agents) ? 2 : 1;
  };
  const link = (): WizardLink => (step() === 2 ? "connected" : "connecting");
  const workspace = () => props.connection?.workspaceName ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t(text().connectTitle), description: t(text().connectDescription) };
      case 1:
        return {
          title: t(text().agentStepTitle),
          description: t(text().agentStepDescription, { workspace: workspace() }),
        };
      case 2:
        return {
          title: t(text().doneTitle, { workspace: workspace() }),
          description: t(text().doneDescription),
        };
    }
  };
  const steps = () => [t(text().stepWorkspace), t(text().stepAgent)];
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t(text().close)}
      onClose={props.onClose}
      logo={<MessagingMark platform={props.platform} />}
      link={link()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t(text().connect)} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button
              type="button"
              size="sm"
              loading={props.busy}
              onClick={() => {
                setWaiting(true);
                props.onConnectWorkspace();
              }}
            >
              <ExternalLink size={14} aria-hidden="true" />
              {t(text().connectInApp)}
            </Button>
          </Match>
          <Match when={step() === 1 && props.connection}>
            {(connection) => (
              <Button
                type="button"
                size="sm"
                loading={props.busy}
                onClick={() => props.onAddOrchestrator(connection().workspaceId, choice())}
              >
                {t(text().addAgent)}
              </Button>
            )}
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t(text().done)}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === 0}>
          <Show
            when={waiting()}
            fallback={
              <ol class="slack-checklist">
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t(text().connectStepBrowser)}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t(text().connectStepAllow)}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t(text().connectStepReturn)}
                </li>
              </ol>
            }
          >
            <div class="slack-waiting" aria-live="polite">
              <Spinner size="sm" />
              <Text variant="caption" tone="muted">
                {t(text().connectWaiting)}
              </Text>
            </div>
          </Show>
        </Match>
        <Match when={step() === 1}>
          <div class="slack-orchestrator-card">
            <OrchestratorFace platform={props.platform} size="lg" />
            <div class="slack-integration-stack">
              <Text as="span" variant="label">
                {t(text().orchestratorName)}
              </Text>
              <Text as="span" variant="caption" tone="muted">
                {t(text().orchestratorRole)}
              </Text>
            </div>
          </div>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesReceive)}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesDelegate)}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t(text().orchestratorDoesAnswer)}
            </li>
          </ol>
          <Show when={props.models}>
            {(models) => (
              <Show when={choice()}>
                {(current) => (
                  <div class="slack-orchestrator-model">
                    <Text as="span" variant="label-sm">
                      {t(text().orchestratorModel)}
                    </Text>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t(text().orchestratorModel)}
                      provider={current().provider}
                      value={current().model}
                      modelOptions={models().modelOptions}
                      agentStatus={models().agentStatus}
                      customProviders={models().customProviders}
                      customAgents={models().customAgents}
                      disabled={props.busy}
                      onChange={(model, provider) => setChoice({ provider, model })}
                    />
                  </div>
                )}
              </Show>
            )}
          </Show>
        </Match>
      </Switch>
    </WizardDialog>
  );
}

function DisconnectDialog(props: {
  platform?: WorkspacePlatform | undefined;
  hostName?: string | undefined;
  connection: MessagingConnection | null;
  deletesOrchestrator: boolean;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const text = () => messagingPlatformText(props.platform);
  const workspace = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t(text().close)}
      onClose={props.onClose}
      logo={<MessagingMark platform={props.platform} />}
      link="broken"
      title={t(text().disconnectTitle, { workspace: workspace() })}
      description={
        props.hostName
          ? t(text().disconnectDescriptionHost, { workspace: workspace(), host: props.hostName })
          : t(text().disconnectDescription, { workspace: workspace() })
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t(text().keep)}
          </Button>
          <Show when={props.connection}>
            {(connection) => (
              <Button
                type="button"
                variant="destructive"
                data-cuelume-tap="close"
                data-cuelume-emphasis="strong"
                onClick={() => props.onConfirm(connection().workspaceId)}
              >
                <Link2Off aria-hidden="true" />
                {t(text().disconnectWorkspace)}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <ul class="slack-effects">
        <li data-tone="danger">
          <span class="slack-effect-icon" aria-hidden="true">
            <Link2Off />
          </span>
          {t(text().disconnectEffect, { workspace: workspace() })}
        </li>
        <Show
          when={props.deletesOrchestrator}
          fallback={
            <li data-tone="success">
              <span class="slack-effect-icon" aria-hidden="true">
                <Check />
              </span>
              {t(text().removeEffectKept)}
            </li>
          }
        >
          <li data-tone="danger">
            <span class="slack-effect-icon" aria-hidden="true">
              <Trash2 />
            </span>
            {t(text().removeEffectDeleted)}
          </li>
        </Show>
      </ul>
    </WizardDialog>
  );
}
