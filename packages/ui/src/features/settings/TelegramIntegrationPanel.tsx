import type { ConnectTelegramChatInput, MessagingConnection } from "@openbot/contracts/ipc";
import { TELEGRAM_ORCHESTRATOR_AVATAR } from "@openbot/contracts/telegram-app";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
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
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { TelegramMark } from "./brand-marks";
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
import {
  messagingStateUnknown,
  type SlackIntegrationAgent,
  type SlackOrchestratorChoice,
  type SlackOrchestratorModels,
} from "./SlackIntegrationPanel";

// The Telegram page uses the styles of the Slack page (`slack-integration.css`): the two pages have
// the same layout.

export type TelegramIntegrationAgent = SlackIntegrationAgent;
/** The model of the Telegram Orchestrator that the user picks in the connect dialog. */
export type TelegramOrchestratorChoice = SlackOrchestratorChoice;
/** The catalog behind the model picker. Absent, the orchestrator starts on a new agent's default. */
export type TelegramOrchestratorModels = SlackOrchestratorModels;
export type TelegramChatPlace = ConnectTelegramChatInput["place"];

export interface TelegramIntegrationPanelProps {
  /** Every agent on this computer. */
  agents: TelegramIntegrationAgent[];
  /** The linked Telegram chats. */
  connections: MessagingConnection[];
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  models?: TelegramOrchestratorModels | undefined;
  /** Resolves `false` when the link did not open, so nothing waits for Telegram. */
  onConnectChat: (place: TelegramChatPlace) => Promise<boolean>;
  onDisconnectChat: (workspaceId: string) => void;
  onReconnect: (workspaceId: string) => void;
  onSetEnabled: (workspaceId: string, enabled: boolean) => void;
  onAddOrchestrator: (choice: TelegramOrchestratorChoice | null) => void;
  /** The joined server's name, when the chats are that server's and not this computer's. */
  hostName?: string | undefined;
  /**
   * Why the last read of the chats failed. `connections` are from an earlier read; with none, the
   * state is not known, so the page shows the reason and Retry and offers no connect.
   */
  loadError?: string | null | undefined;
  /** Reads the chats again. */
  onRetry?: (() => void) | undefined;
}

/** What a chat row can do. */
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

const STATE_HELP: Partial<Record<MessagingConnection["state"], AppTextKey>> = {
  removed: "connector.telegram.helpRemoved",
  relay_unavailable: "connector.telegram.helpRelayUnavailable",
  invalid_token: "connector.telegram.helpError",
  secret_storage_unavailable: "connector.telegram.helpError",
  error: "connector.telegram.helpError",
};

/** Telegram gives a group, a supergroup and a channel a negative ID, and a direct chat a positive one. */
function isGroupChat(connection: MessagingConnection): boolean {
  return connection.workspaceId.startsWith("-");
}

/** The one orchestrator agent of all Telegram chats, when it still exists. */
export function telegramOrchestrator<Agent extends { id: string }>(
  connections: readonly MessagingConnection[],
  agents: readonly Agent[],
): Agent | null {
  for (const connection of connections) {
    const agent = agents.find((candidate) => candidate.id === connection.orchestratorAgentId);
    if (agent) return agent;
  }
  return null;
}

/** The state of the whole Telegram integration, for the page header and the Connectors list. */
export function telegramIntegrationState(
  connections: readonly MessagingConnection[],
  agents: readonly { id: string }[],
  loadError?: string | null,
): { status: IntegrationStatus; label: AppTextKey; attention: number } {
  if (messagingStateUnknown({ connections, loadError })) return { ...UNKNOWN_STATUS, attention: 0 };
  const orchestrator = telegramOrchestrator(connections, agents);
  const attention = connections.filter((connection) => rowKind(connection) === "attention" || !orchestrator).length;
  if (attention > 0) return { status: "attention", label: "connector.telegram.statusAttention", attention };
  if (connections.length === 0) return { status: "idle", label: "connector.telegram.statusNotSetUp", attention };
  return { status: "connected", label: "connector.telegram.statusConnected", attention };
}

/**
 * Server settings > Connectors > Telegram. Each chat adds the one OpenBot bot, and one Telegram
 * Orchestrator agent receives the messages of all chats, asks the team and answers. A chat links in
 * Telegram, so the chat list follows the connections that the caller reads again.
 */
export function TelegramIntegrationPanel(props: TelegramIntegrationPanelProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [disconnecting, setDisconnecting] = createSignal<MessagingConnection | null>(null);
  /** The chats before the user pressed a link action. A chat that is not in it is the new one. */
  const [linking, setLinking] = createSignal<ReadonlySet<string> | null>(null);
  const state = () => telegramIntegrationState(props.connections, props.agents, props.loadError);
  const unknown = () => messagingStateUnknown(props);
  const orchestrator = () => telegramOrchestrator(props.connections, props.agents);
  const setUpDone = () => props.connections.length > 0 && orchestrator() !== null;
  const waiting = () => {
    const before = linking();
    return before !== null && props.connections.every((connection) => before.has(connection.workspaceId));
  };
  const link = (place: TelegramChatPlace) => {
    setLinking(new Set(props.connections.map((connection) => connection.workspaceId)));
    void props.onConnectChat(place).then((opened) => {
      if (!opened) setLinking(null);
    });
  };

  return (
    <div class="slack-integration">
      <DetailHeader
        logo={<TelegramMark />}
        name={t("connector.telegram.title")}
        status={state().status}
        statusLabel={t(state().label)}
        subtitle={t("connector.telegram.description")}
        actions={
          <Show when={!setUpDone() && !unknown()}>
            <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
              {props.connections.length > 0 ? t("connector.telegram.addAgent") : t("connector.telegram.connect")}
            </Button>
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
            <AlertTitle>{t("connector.telegram.attentionTitle", { count: state().attention })}</AlertTitle>
            <AlertDescription>{t("connector.telegram.attentionDescription")}</AlertDescription>
          </AlertContent>
        </Alert>
      </Show>

      {/* Not set up, the header holds the only step: Connect Telegram. */}
      <Show when={props.connections.length > 0}>
        <SettingsSection title={t("connector.telegram.chatsTitle")}>
          <ItemGroup class="settings-modal-card">
            <For each={props.connections}>
              {(connection) => (
                <ChatRow
                  connection={connection}
                  hostName={props.hostName}
                  busy={props.busy}
                  onReconnect={() => props.onReconnect(connection.workspaceId)}
                  onSetEnabled={(enabled) => props.onSetEnabled(connection.workspaceId, enabled)}
                  onDisconnect={() => setDisconnecting(connection)}
                />
              )}
            </For>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("connector.telegram.linkTitle")}</ItemTitle>
                <ItemDescription aria-live="polite">
                  {waiting() ? t("connector.telegram.linkWaiting") : t("connector.telegram.linkDescription")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Show when={waiting()}>
                  <Spinner size="sm" />
                </Show>
                <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => link("group")}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.telegram.addToGroup")}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={() => link("direct")}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("connector.telegram.openDirectChat")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </SettingsSection>

        <SettingsSection
          title={t("connector.telegram.orchestratorTitle")}
          description={t("connector.telegram.orchestratorDescription")}
        >
          <ItemGroup class="settings-modal-card">
            <Show
              when={orchestrator()}
              fallback={
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <OrchestratorFace />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t("connector.telegram.orchestratorNone")}</ItemTitle>
                    <ItemDescription>{t("connector.telegram.orchestratorNoneDescription")}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button type="button" size="sm" disabled={props.busy} onClick={() => setDialogOpen(true)}>
                      {t("connector.telegram.addAgent")}
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
            {t("connector.telegram.mentionNote")}
          </Text>
        </SettingsSection>
      </Show>

      <TelegramConnectDialog
        open={dialogOpen()}
        connections={props.connections}
        agents={props.agents}
        busy={props.busy}
        models={props.models}
        onConnectChat={props.onConnectChat}
        onAddOrchestrator={props.onAddOrchestrator}
        onClose={() => setDialogOpen(false)}
      />
      <DisconnectDialog
        connection={disconnecting()}
        deletesOrchestrator={props.connections.length === 1 && orchestrator() !== null}
        onConfirm={(workspaceId) => {
          setDisconnecting(null);
          props.onDisconnectChat(workspaceId);
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  );
}

function OrchestratorFace(props: { size?: "md" | "lg" }) {
  return (
    <span class="integrations-agent-face" data-size={props.size ?? "md"}>
      <AgentAvatar
        seed={TELEGRAM_ORCHESTRATOR_AVATAR.avatarSeed}
        hue={TELEGRAM_ORCHESTRATOR_AVATAR.avatarHue}
        motion="idle"
      />
    </span>
  );
}

function ChatRow(props: {
  connection: MessagingConnection;
  hostName?: string | undefined;
  busy: boolean;
  onReconnect: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t, format } = useText();
  const kind = () => rowKind(props.connection);
  const note = () => {
    const current = props.connection;
    if (current.retryAt)
      return t("connector.telegram.retryAt", {
        time: format.date(new Date(current.retryAt), { hour: "numeric", minute: "2-digit" }),
      });
    if (current.state === "relay_unavailable" && props.hostName)
      return t("connector.telegram.helpRelayUnavailableHost", { host: props.hostName });
    const help = STATE_HELP[current.state];
    if (help) return t(help);
    return isGroupChat(current) ? t("connector.telegram.groupDescription") : t("connector.telegram.directDescription");
  };
  const label = (action: string) => t("connector.telegram.rowAction", { action, name: props.connection.workspaceName });
  const action = (text: string, onClick: () => void) => (
    <Button type="button" size="sm" variant="outline" disabled={props.busy} aria-label={label(text)} onClick={onClick}>
      {text}
    </Button>
  );
  return (
    <Item class="settings-modal-row" data-status={kind()}>
      <ItemMedia>
        <LogoTile>
          <TelegramMark />
        </LogoTile>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.connection.workspaceName}</ItemTitle>
        <ItemDescription>{note()}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch>
          {/* A removed chat is unlinked from this computer. Only a new link with the bot brings it back. */}
          <Match when={kind() === "attention" && props.connection.state !== "removed"}>
            {action(t("connector.telegram.reconnect"), props.onReconnect)}
          </Match>
          <Match when={kind() === "paused"}>
            {action(t("connector.telegram.resume"), () => props.onSetEnabled(true))}
          </Match>
          <Match when={kind() === "live"}>
            {action(t("connector.telegram.pause"), () => props.onSetEnabled(false))}
          </Match>
        </Switch>
        <Button
          type="button"
          size="sm"
          variant="destructive-ghost"
          disabled={props.busy}
          aria-label={label(t("connector.telegram.disconnectChat"))}
          onClick={props.onDisconnect}
        >
          {t("connector.telegram.disconnectChat")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** 0 links a chat, 1 adds the orchestrator, and 2 is done. */
type ConnectStep = 0 | 1 | 2;

/**
 * Connects Telegram in two steps. The chat links in Telegram, outside the dialog, so the step follows
 * the connections: no chat is step 1, chats with no orchestrator are step 2, and an orchestrator is
 * done. The orchestrator shows only on a chat, so the chat comes first.
 */
export function TelegramConnectDialog(props: {
  open: boolean;
  connections: readonly MessagingConnection[];
  agents: readonly { id: string }[];
  busy: boolean;
  models?: TelegramOrchestratorModels | undefined;
  onConnectChat: (place: TelegramChatPlace) => Promise<boolean>;
  onAddOrchestrator: (choice: TelegramOrchestratorChoice | null) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const [waiting, setWaiting] = createSignal(false);
  const [choice, setChoice] = createSignal<TelegramOrchestratorChoice | null>(null);
  /** The chats when the dialog opened. A chat that is not in it is the one that the user just linked. */
  const [before, setBefore] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setWaiting(false);
      setChoice(props.models?.initial ?? null);
      setBefore(new Set(props.connections.map((connection) => connection.workspaceId)));
    },
  );
  const first = () => props.connections[0] ?? null;
  const linked = () => props.connections.find((connection) => !before().has(connection.workspaceId)) ?? first();
  const step = (): ConnectStep => {
    if (!first()) return 0;
    return telegramOrchestrator(props.connections, props.agents) ? 2 : 1;
  };
  const dialogLink = (): WizardLink => (step() === 2 ? "connected" : "connecting");
  const chat = () => linked()?.workspaceName ?? "";
  const copy = () => {
    switch (step()) {
      case 0:
        return { title: t("connector.telegram.connectTitle"), description: t("connector.telegram.connectDescription") };
      case 1:
        return {
          title: t("connector.telegram.agentStepTitle"),
          description: t("connector.telegram.agentStepDescription", { chat: chat() }),
        };
      case 2:
        return {
          title: t("connector.telegram.doneTitle", { chat: chat() }),
          description: t("connector.telegram.mentionNote"),
        };
    }
  };
  const steps = () => [t("connector.telegram.stepChat"), t("connector.telegram.stepAgent")];
  const connect = (place: TelegramChatPlace) => {
    setWaiting(true);
    void props.onConnectChat(place).then((opened) => {
      if (!opened) setWaiting(false);
    });
  };
  return (
    <WizardDialog
      open={props.open}
      closeLabel={t("connector.telegram.close")}
      onClose={props.onClose}
      logo={<TelegramMark />}
      link={dialogLink()}
      title={copy().title}
      description={copy().description}
      stepper={<Stepper steps={steps()} current={step()} label={t("connector.telegram.connect")} />}
      footer={
        <Switch>
          <Match when={step() === 0}>
            <Button type="button" size="sm" variant="outline" loading={props.busy} onClick={() => connect("direct")}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.telegram.openDirectChat")}
            </Button>
            <Button type="button" size="sm" loading={props.busy} onClick={() => connect("group")}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("connector.telegram.addToGroup")}
            </Button>
          </Match>
          <Match when={step() === 1}>
            <Button type="button" size="sm" loading={props.busy} onClick={() => props.onAddOrchestrator(choice())}>
              {t("connector.telegram.addAgent")}
            </Button>
          </Match>
          <Match when={step() === 2}>
            <Button type="button" size="sm" onClick={props.onClose}>
              {t("connector.telegram.done")}
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
                  {t("connector.telegram.connectStepBrowser")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.telegram.connectStepPick")}
                </li>
                <li>
                  <span class="slack-checklist-dot" aria-hidden="true" />
                  {t("connector.telegram.connectStepReturn")}
                </li>
              </ol>
            }
          >
            <div class="slack-waiting" aria-live="polite">
              <Spinner size="sm" />
              <Text variant="caption" tone="muted">
                {t("connector.telegram.connectWaiting")}
              </Text>
            </div>
          </Show>
        </Match>
        <Match when={step() === 1}>
          <div class="slack-orchestrator-card">
            <OrchestratorFace size="lg" />
            <div class="slack-integration-stack">
              <Text as="span" variant="label">
                {t("connector.telegram.orchestratorName")}
              </Text>
              <Text as="span" variant="caption" tone="muted">
                {t("connector.telegram.orchestratorRole")}
              </Text>
            </div>
          </div>
          <ol class="slack-checklist">
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.telegram.orchestratorDoesReceive")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.telegram.orchestratorDoesDelegate")}
            </li>
            <li data-state="done">
              <Check size={14} aria-hidden="true" />
              {t("connector.telegram.orchestratorDoesAnswer")}
            </li>
          </ol>
          <Show when={props.models}>
            {(models) => (
              <Show when={choice()}>
                {(current) => (
                  <div class="slack-orchestrator-model">
                    <Text as="span" variant="label-sm">
                      {t("connector.telegram.orchestratorModel")}
                    </Text>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t("connector.telegram.orchestratorModel")}
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
  connection: MessagingConnection | null;
  /** The last linked chat: its disconnect deletes the Telegram Orchestrator. */
  deletesOrchestrator: boolean;
  onConfirm: (workspaceId: string) => void;
  onClose: () => void;
}) {
  const { t } = useText();
  const chat = () => props.connection?.workspaceName ?? "";
  return (
    <WizardDialog
      open={props.connection !== null}
      closeLabel={t("connector.telegram.close")}
      onClose={props.onClose}
      logo={<TelegramMark />}
      link="broken"
      title={t("connector.telegram.disconnectTitle", { chat: chat() })}
      description={t("connector.telegram.leaveDescription", { chat: chat() })}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t("connector.telegram.keep")}
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
                {t("connector.telegram.disconnectChat")}
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
          {t("connector.telegram.disconnectEffect", { chat: chat() })}
        </li>
        <Show
          when={props.deletesOrchestrator}
          fallback={
            <li data-tone="success">
              <span class="slack-effect-icon" aria-hidden="true">
                <Check />
              </span>
              {t("connector.telegram.removeEffectKept")}
            </li>
          }
        >
          <li data-tone="danger">
            <span class="slack-effect-icon" aria-hidden="true">
              <Trash2 />
            </span>
            {t("connector.telegram.removeEffectDeleted")}
          </li>
        </Show>
      </ul>
    </WizardDialog>
  );
}
