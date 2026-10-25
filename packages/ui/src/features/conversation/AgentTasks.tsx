import type {
  AgentApproval,
  AgentTask,
  AgentTaskHold,
  AgentTaskOutcome,
  AttachmentSummary,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { isAgentTaskActive, isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { ArrowUp, Button, ChevronLeft, ChevronRight, Plus, X } from "@openbot/ui";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { AgentActivityIndicator, nextAgentActivityLabel } from "@openbot/ui/features/conversation/AgentActivity";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { TaskMark, type TaskMarkState } from "@openbot/ui/features/conversation/TaskList";
import { type TextValue, useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";

const HOLD_TEXT = {
  "agent-restarting": "conversation.tasks.hold.agentRestarting",
  "usage-limit": "conversation.tasks.hold.usageLimit",
  "server-busy": "conversation.tasks.hold.serverBusy",
  "agent-busy": "conversation.tasks.hold.agentBusy",
  "one-turn": "conversation.tasks.hold.oneTurn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, AppTextKey>;

const OUTCOME_TEXT = {
  completed: "conversation.tasks.state.completed",
  failed: "conversation.tasks.state.failed",
  interrupted: "conversation.tasks.state.interrupted",
} as const satisfies Record<AgentTaskOutcome, AppTextKey>;

function taskMarkState(task: AgentTask): TaskMarkState {
  if (task.state === "running") return "active";
  if (task.state === "queued" || task.outcome === null) return "pending";
  return task.outcome === "completed" ? "done" : "failed";
}

/**
 * The state of a task in a few words: that a running task waits for an approval, what it does now,
 * else how its last turn ended.
 */
export function agentTaskStatus(task: AgentTask, t: TextValue["t"], waitsForApproval = false): string {
  if (task.state === "running" && waitsForApproval) return t("conversation.tasks.state.waitingApproval");
  if (task.state === "running") return task.progress ?? t("conversation.tasks.state.running");
  if (task.state === "queued") return t("conversation.tasks.state.queued");
  if (task.outcome === null) return t("conversation.tasks.state.new");
  return t(OUTCOME_TEXT[task.outcome]);
}

/**
 * Whether the panel shows this message. A stopped turn can leave an agent message with no text and
 * nothing else in it; the thinking of a turn shows only while the task runs, in its activity row.
 */
function shownInPanel(message: AgentMessage): boolean {
  if (message.kind === "thinking" || message.kind === "memory-changes") return false;
  return (
    message.author === "you" ||
    message.streaming === true ||
    message.body.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    message.imageGeneration !== undefined ||
    message.questionPrompt !== undefined ||
    message.plan !== undefined ||
    message.actionMarker !== undefined
  );
}

/** Why the next message of a queued task waits. */
export function agentTaskHoldText(task: AgentTask, limit: number, t: TextValue["t"]): string | null {
  if (task.state !== "queued") return null;
  if (task.hold === "task-limit" || task.hold === null) return t("conversation.tasks.hold.taskLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}

/**
 * The state glyph of a task, with its state as the accessible name. `decorative` hides it where the
 * state is already in the text beside it.
 */
export function AgentTaskMark(props: { task: AgentTask; decorative?: boolean; waitsForApproval?: boolean }) {
  const { t } = useText();
  return (
    <Show
      when={!props.decorative}
      fallback={
        <span class="agent-tasks-mark" aria-hidden="true">
          <TaskMark state={taskMarkState(props.task)} />
        </span>
      }
    >
      <span
        class="agent-tasks-mark"
        role="img"
        aria-label={agentTaskStatus(props.task, t, props.waitsForApproval)}
        title={agentTaskStatus(props.task, t, props.waitsForApproval)}
      >
        <TaskMark state={taskMarkState(props.task)} />
      </span>
    </Show>
  );
}

/**
 * The open tasks of the agent, at the foot of its chat. A chip opens its task in the side panel;
 * the close button moves a task to the closed tasks of the Tasks pane, where it can reopen.
 */
export function AgentTaskChips(props: {
  tasks: readonly AgentTask[];
  onOpen: (taskId: string) => void;
  onClose: (taskId: string) => void;
  waitsForApproval?: ((task: AgentTask) => boolean) | undefined;
}) {
  const { t } = useText();
  return (
    <Show when={props.tasks.length > 0}>
      <ul class="agent-task-chips" aria-label={t("conversation.tasks.list")}>
        <For each={props.tasks} keyed={(task) => task.id}>
          {(task) => (
            <li class="agent-task-chip-row">
              <Button
                type="button"
                variant="ghost"
                class="agent-task-chip"
                aria-label={t("conversation.tasks.chip.open", {
                  title: task().title,
                  status: agentTaskStatus(task(), t, props.waitsForApproval?.(task())),
                })}
                onClick={() => props.onOpen(task().id)}
              >
                <TaskMark state={taskMarkState(task())} />
                <span class="agent-task-chip-title">{task().title}</span>
                <span class="agent-task-chip-status">
                  {agentTaskStatus(task(), t, props.waitsForApproval?.(task()))}
                </span>
                <ChevronRight class="agent-task-chip-chevron" aria-hidden="true" />
              </Button>
              <Show when={!isAgentTaskActive(task())}>
                <Button
                  type="button"
                  variant="ghost"
                  class="agent-task-chip-close"
                  aria-label={t("conversation.tasks.chip.close", { title: task().title })}
                  title={t("conversation.tasks.panel.close")}
                  onClick={() => props.onClose(task().id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

export interface AgentTaskPanelProps {
  /** Null for a new task: its first message starts it. */
  task: AgentTask | null;
  /** How many tasks of the agent can run at the same time. */
  limit: number;
  agent: AgentProfile;
  agents: AgentProfile[];
  messages: readonly AgentMessage[];
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onCloseTask: () => void;
  onReopen: () => void;
  onClosePanel: () => void;
  /** Back to the task list of the side panel. */
  onBack?: (() => void) | undefined;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** The approval that the task's running turn waits for. */
  approval?: AgentApproval | undefined;
  onRespondApproval: (decision: "accept" | "decline") => Promise<boolean>;
}

export interface AgentTaskListProps {
  /** The open tasks first, then the newest closed ones. */
  tasks: readonly AgentTask[];
  onNew: () => void;
  onOpen: (taskId: string) => void;
  onClosePanel: () => void;
  waitsForApproval?: ((task: AgentTask) => boolean) | undefined;
}

/** The closed tasks that the Tasks pane shows before "Show all". */
const CLOSED_TASKS_SHOWN = 5;

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/**
 * The Tasks pane of the side panel: a new task, the open tasks, then the newest closed tasks under a
 * heading for each day.
 */
export function AgentTaskList(props: AgentTaskListProps) {
  const { t, format } = useText();
  const [showAll, setShowAll] = createSignal(false);
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  // New tasks and "Show all" change the scroll height while the list keeps its size.
  createEffect(
    () => [props.tasks.length, showAll()],
    () => fades.remeasure(),
  );
  const openTasks = () => props.tasks.filter(isAgentTaskOpen);
  const closedTasks = () => props.tasks.filter((task) => !isAgentTaskOpen(task));
  const closedAt = (task: AgentTask) => new Date(task.closedAt ?? task.updatedAt);
  const dayLabel = (date: Date) => {
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    if (days === 0) return t("conversation.tasks.day.today");
    if (days === 1) return t("conversation.tasks.day.yesterday");
    return format.date(date, { weekday: "long", month: "short", day: "numeric" });
  };
  /** The shown closed tasks, newest first as the snapshot orders them, in one group for each day. */
  const closedGroups = () => {
    const shown = showAll() ? closedTasks() : closedTasks().slice(0, CLOSED_TASKS_SHOWN);
    const groups: { day: number; label: string; tasks: AgentTask[] }[] = [];
    for (const task of shown) {
      const date = closedAt(task);
      const day = startOfDay(date);
      const last = groups.at(-1);
      if (last?.day === day) last.tasks.push(task);
      else groups.push({ day, label: dayLabel(date), tasks: [task] });
    }
    return groups;
  };
  return (
    <aside id="agent-task-panel" class="browser-panel agent-tasks-panel" aria-label={t("conversation.tasks.title")}>
      <header class="file-preview-header side-panel-pane-header">
        <h2>{t("conversation.tasks.title")}</h2>
        <Button
          type="button"
          variant="ghost"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("conversation.tasks.panel.closePanel")}
          onClick={() => props.onClosePanel()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <div class={["agent-task-list", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
        <Button variant="ghost" type="button" class="agent-tasks-row" onClick={() => props.onNew()}>
          <Plus class="agent-tasks-icon" aria-hidden="true" />
          <span>{t("conversation.tasks.new")}</span>
        </Button>
        <For each={openTasks()} keyed={(task) => task.id}>
          {(task) => (
            <Button variant="ghost" type="button" class="agent-tasks-row" onClick={() => props.onOpen(task().id)}>
              <AgentTaskMark task={task()} decorative />
              <span class="agent-tasks-menu-title">{task().title}</span>
              <small>{agentTaskStatus(task(), t, props.waitsForApproval?.(task()))}</small>
            </Button>
          )}
        </For>
        <For each={closedGroups()} keyed={(group) => group.day}>
          {(group) => (
            <section class="agent-task-list-group">
              <h3 class="agent-task-list-day">{group().label}</h3>
              <For each={group().tasks} keyed={(task) => task.id}>
                {(task) => (
                  <Button variant="ghost" type="button" class="agent-tasks-row" onClick={() => props.onOpen(task().id)}>
                    <AgentTaskMark task={task()} />
                    <span class="agent-tasks-menu-title">{task().title}</span>
                    <small>{format.date(closedAt(task()), { hour: "2-digit", minute: "2-digit" })}</small>
                  </Button>
                )}
              </For>
            </section>
          )}
        </For>
        <Show when={!showAll() && closedTasks().length > CLOSED_TASKS_SHOWN}>
          <Button
            variant="ghost"
            type="button"
            class="agent-tasks-row agent-tasks-disclosure"
            onClick={() => setShowAll(true)}
          >
            <ChevronRight class="agent-tasks-icon" aria-hidden="true" />
            <span>{t("conversation.tasks.showAll", { count: closedTasks().length })}</span>
          </Button>
        </Show>
      </div>
    </aside>
  );
}

/**
 * One task in the side panel: its messages, why it waits, and a message box. While the task runs,
 * a message waits in it, or steers it as the busy-message mode says; after that, a message continues it.
 */
export function AgentTaskPanel(props: AgentTaskPanelProps) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  // The panel stays mounted when the user opens another task, so text typed for one task must not go to the next.
  createEffect(
    () => props.task?.id,
    () => {
      setDraft("");
    },
  );
  const activityLabel = nextAgentActivityLabel();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const closed = () => props.task?.state === "closed";
  const title = () => props.task?.title ?? t("conversation.tasks.new");
  const placeholder = () => {
    const task = props.task;
    if (!task) return t("conversation.tasks.panel.newPlaceholder", { name: props.agent.name });
    return isAgentTaskActive(task)
      ? t("conversation.tasks.panel.messagePlaceholder")
      : t("conversation.tasks.panel.continuePlaceholder");
  };
  const send = async () => {
    const text = draft().trim();
    if (!text || sending()) return;
    setSending(true);
    try {
      if (await props.onSend(text)) setDraft("");
    } finally {
      setSending(false);
    }
  };
  const author = (message: AgentMessage) =>
    message.author === "you"
      ? { kind: "you" as const, name: t("chat.message.you") }
      : { kind: "agent" as const, name: props.agent.name, agent: props.agent };
  return (
    <aside
      id="agent-task-panel"
      class="browser-panel agent-tasks-panel"
      aria-label={t("conversation.tasks.panel.label", { title: title() })}
    >
      <header class="file-preview-header">
        <Show when={props.onBack}>
          {(back) => (
            <Button
              type="button"
              variant="ghost"
              class="browser-toolbar-button"
              aria-label={t("conversation.tasks.panel.back")}
              onClick={() => back()()}
            >
              <ChevronLeft class="browser-toolbar-icon" />
            </Button>
          )}
        </Show>
        <Show when={props.task}>
          {(task) => <AgentTaskMark task={task()} waitsForApproval={props.approval !== undefined} />}
        </Show>
        <h2 title={title()}>{title()}</h2>
        <Show when={props.task}>
          {(task) => (
            <Show
              when={isAgentTaskActive(task())}
              fallback={
                <Show
                  when={closed()}
                  fallback={
                    <Button type="button" variant="ghost" size="xs" onClick={() => props.onCloseTask()}>
                      {t("conversation.tasks.panel.close")}
                    </Button>
                  }
                >
                  <Button type="button" variant="ghost" size="xs" onClick={() => props.onReopen()}>
                    {t("conversation.tasks.panel.reopen")}
                  </Button>
                </Show>
              }
            >
              <Button type="button" variant="ghost" size="xs" onClick={() => props.onStop()}>
                {t("conversation.tasks.panel.stop")}
              </Button>
            </Show>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("conversation.tasks.panel.closePanel")}
          onClick={() => props.onClosePanel()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <section
        class={["conversation-scroll agent-tasks-panel-scroll", fades.classes()]}
        aria-label={t("conversation.tasks.panel.messages")}
        ref={fades.bind}
        onScroll={fades.measure}
      >
        <div class="virtual-chat-list virtual-chat-list-static" ref={fades.watch}>
          <Show when={props.task?.origin === "agent"}>
            <p class="agent-tasks-panel-origin">
              {t("conversation.tasks.panel.startedByAgent", { name: props.agent.name })}
            </p>
          </Show>
          <For each={props.messages.filter(shownInPanel)} keyed={(message) => message.id}>
            {(message) => (
              <div class="virtual-chat-row">
                <ChatMessageRow
                  message={message()}
                  author={author(message())}
                  agents={props.agents}
                  onSelectAgent={() => undefined}
                  onOpenLink={props.onOpenLink}
                  onPreview={props.onPreview}
                  onAttachmentAction={props.onAttachmentAction}
                />
              </div>
            )}
          </For>
          <Show when={props.task?.state === "running" && !props.approval ? props.task : undefined}>
            {(task) => (
              <div class="virtual-chat-row">
                <AgentActivityIndicator agent={props.agent} label={activityLabel} detail={task().progress} />
              </div>
            )}
          </Show>
          <Show keyed when={props.approval}>
            {(approval) => (
              <div class="virtual-chat-row">
                <ApprovalCard
                  approval={approval}
                  agentName={props.agent.name}
                  onApprove={() => props.onRespondApproval("accept")}
                  onReject={() => props.onRespondApproval("decline")}
                />
              </div>
            )}
          </Show>
          <Show when={props.task && agentTaskHoldText(props.task, props.limit, t)}>
            {(hold) => (
              <div class="virtual-chat-row">
                <p class="agent-queue-hold" role="status">
                  {hold()}
                </p>
              </div>
            )}
          </Show>
          <Show when={props.task && props.task.queuedMessages.length > 0 ? props.task : undefined}>
            {(task) => (
              <section class="agent-tasks-panel-queued" aria-label={t("conversation.tasks.panel.queued")}>
                <For each={task().queuedMessages} keyed={(queued) => queued.deliveryId}>
                  {(queued) => <p class="agent-tasks-panel-queued-text">{queued().text}</p>}
                </For>
              </section>
            )}
          </Show>
        </div>
      </section>
      <Show when={!closed()} fallback={<p class="agent-tasks-panel-note">{t("conversation.tasks.panel.closed")}</p>}>
        <div class="composer-wrap">
          <Show when={props.task?.state === "idle" && props.task.outcome === "failed" ? props.task : undefined}>
            {(task) => (
              <ComposerNotice
                tone="danger"
                title={t("conversation.tasks.panel.failed")}
                body={task().error || t("conversation.tasks.panel.failedBody")}
              />
            )}
          </Show>
          <form
            class="composer"
            data-compact="true"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div class="composer-input-label">
              <ComposerEditor
                agentId={props.agent.id}
                agents={props.agents}
                value={draft()}
                placeholder={placeholder()}
                ariaLabel={placeholder()}
                disabled={sending()}
                onSubmit={() => void send()}
                onValueChange={setDraft}
              />
            </div>
            <div class="composer-toolbar">
              <div class="composer-primary-actions">
                <Button
                  type="submit"
                  variant="ghost"
                  class="voice-button"
                  aria-label={t("conversation.tasks.panel.send")}
                  disabled={sending() || draft().trim().length === 0}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              </div>
            </div>
          </form>
        </div>
      </Show>
    </aside>
  );
}
