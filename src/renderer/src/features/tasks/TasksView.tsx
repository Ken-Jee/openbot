import type {
  AgentApproval,
  AgentTask,
  AgentTasksSnapshot,
  AttachmentSummary,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { plainTaskTitle, taskApproval } from "@openbot/team-client/agent-tasks";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { AgentTaskPanel } from "@openbot/ui/features/conversation/AgentTasks";
import { TasksPage, type TasksVoice } from "@openbot/ui/features/tasks/TasksPage";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createProjection, createStore, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { toAgentMessages } from "../../app-message-projection";
import { readAgentSelection, writeAgentSelection } from "../agents/agent-selection";
import type { TaskEvent, TasksSource } from "./tasks-port";

/** How long a start waits before it reaches the agent. Undo cancels it in this time. */
const UNDO_MS = 6_000;
/** The longest task title that the host keeps. */
const TITLE_LIMIT = 120;
/** The agent last chosen on this page for each server, kept apart from the chat agent. */
const TASK_AGENT_STORAGE_KEY = "openbot:task-agent:v1";

/** What the voice of the composer can do on the page: read and change the draft, and start a task. */
export interface TasksVoiceControls {
  serverId: () => string;
  draft: () => string;
  setDraft: (text: string) => void;
  /** Starts a task with this text. False when the text has nothing to do. */
  start: (text: string) => boolean;
  showError: (message: string) => void;
  focus: () => void;
}

/** The voice of the composer. `submit` sends while it records: the transcript starts the task. */
export type TasksVoiceAdapter = TasksVoice & { submit: () => void };

export interface TasksViewProps {
  serverId: string;
  hostName: string;
  onBack?: (() => void) | undefined;
  agentsOpen?: boolean | undefined;
  onToggleAgents?: (() => void) | undefined;
  source: TasksSource;
  agents: AgentProfile[];
  /** Absent where the client cannot record. */
  voice?: ((controls: TasksVoiceControls) => TasksVoiceAdapter) | undefined;
  onOpenLink: (url: string) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
  /** The waiting approvals of the server's agents. */
  approvals: readonly AgentApproval[];
  onRespondApproval: (approval: AgentApproval, decision: "accept" | "decline") => Promise<boolean>;
}

/** A start that waits for its Undo time. Its task shows in the list as queued. */
interface PendingStart {
  task: AgentTask;
  text: string;
  clientMessageId: string;
  /** The server of the start. A server change commits it after `props.serverId` names the new one. */
  serverId: string;
  timer: ReturnType<typeof setTimeout>;
}

interface TasksViewState {
  /** The task list of each agent, by agent id. */
  snapshots: Record<string, AgentTasksSnapshot>;
  /** The conversation of each opened task, by task id. */
  conversations: Record<string, ConversationSnapshot>;
  pending: AgentTask | null;
  agentId: string;
  draft: string;
  focusRequest: number;
  startError: string | null;
  took: { taskId: string; pending: boolean } | null;
  selectedId: string | null;
}

function toastError(error: unknown, fallback: AppTextKey): void {
  const { t, errorMessage } = currentText();
  actionToast.error(errorMessage(error, t(fallback)));
}

/**
 * The tasks of all agents of a server, on desktop and on the web. The page starts a task for the
 * chosen agent a few seconds after the send, so Undo can take it back; opening it or leaving the page
 * starts it at once.
 */
export function TasksView(props: TasksViewProps) {
  const [state, setState] = createStore<TasksViewState>({
    snapshots: {},
    conversations: {},
    pending: null,
    agentId: "",
    draft: "",
    focusRequest: 0,
    startError: null,
    took: null,
    selectedId: null,
  });
  let pending: PendingStart | null = null;
  let generation = 0;
  const listRequests = new Map<string, number>();
  const readRequests = new Map<string, number>();

  // The agent chosen last on this server stays the default, so the user does not choose it again on each visit.
  const savedAgentId = createMemo(() => readAgentSelection(TASK_AGENT_STORAGE_KEY)[props.serverId] ?? "");
  const isListed = (id: string) => props.agents.some((agent) => agent.id === id);
  const agentId = () =>
    isListed(state.agentId) ? state.agentId : isListed(savedAgentId()) ? savedAgentId() : (props.agents[0]?.id ?? "");
  const agentOf = (id: string) => props.agents.find((agent) => agent.id === id);

  const tasks = createMemo<AgentTask[]>(() => {
    const listed = props.agents.flatMap((agent) => state.snapshots[agent.id]?.tasks ?? []);
    return state.pending ? [state.pending, ...listed] : listed;
  });
  const taskOf = (taskId: string) => tasks().find((task) => task.id === taskId);

  function applySnapshot(snapshot: AgentTasksSnapshot): void {
    listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
    setState((draft) => {
      draft.snapshots[snapshot.agentId] = snapshot;
    });
  }

  /** Keeps the newest conversation of a task. A delta raises the revision, so an older snapshot loses. */
  function applyConversation(taskId: string, snapshot: ConversationSnapshot): void {
    const stored = state.conversations[taskId];
    if (stored && snapshot.revision < stored.revision) return;
    setState((draft) => {
      draft.conversations[taskId] = snapshot;
    });
  }

  function applyEvent(event: TaskEvent): void {
    if (event.type === "agent-tasks-changed") {
      applySnapshot(event.snapshot);
      return;
    }
    if (event.type === "agent-task-conversation") {
      applyConversation(event.taskId, event.snapshot);
      return;
    }
    const stored = state.conversations[event.taskId];
    // A task that did not load its conversation reads it whole when it opens.
    if (!stored || event.revision <= stored.revision) return;
    setState((draft) => {
      const conversation = draft.conversations[event.taskId];
      if (!conversation) return;
      conversation.revision = event.revision;
      const existing = conversation.messages.find((message) => message.id === event.messageId);
      if (existing) {
        existing.text += event.delta;
        existing.status = "streaming";
        return;
      }
      conversation.messages.push({
        id: event.messageId,
        turnId: event.turnId,
        author: "assistant",
        text: event.delta,
        createdAt: event.createdAt,
        status: "streaming",
      });
    });
  }

  /** Reads the task lists of the agents. One toast tells of a failure, not one for each agent. */
  function loadLists(agentIds: readonly string[]): void {
    const serverId = props.serverId;
    const current = generation;
    const loads = agentIds.map((id) => {
      const request = (listRequests.get(id) ?? 0) + 1;
      listRequests.set(id, request);
      return props.source.list(id, serverId).then((snapshot) => {
        if (current !== generation || listRequests.get(id) !== request) return;
        setState((draft) => {
          draft.snapshots[id] = snapshot;
        });
      });
    });
    void Promise.allSettled(loads).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed && current === generation) toastError(failed.reason, "conversation.tasks.error.load");
    });
  }

  function readTask(task: AgentTask): void {
    const serverId = props.serverId;
    const current = generation;
    const request = (readRequests.get(task.id) ?? 0) + 1;
    readRequests.set(task.id, request);
    props.source.read({ agentId: task.agentId, taskId: task.id }, serverId).then(
      (snapshot) => {
        if (current === generation && readRequests.get(task.id) === request) applyConversation(task.id, snapshot);
      },
      (error) => {
        if (current === generation && readRequests.get(task.id) === request)
          toastError(error, "conversation.tasks.error.read");
      },
    );
  }

  /** Adds a task that a start returned, so it shows before the list event arrives. */
  function rememberTask(task: AgentTask): void {
    setState((draft) => {
      const snapshot = draft.snapshots[task.agentId];
      if (!snapshot) draft.snapshots[task.agentId] = { agentId: task.agentId, tasks: [task], limit: 1 };
      else if (!snapshot.tasks.some((entry) => entry.id === task.id)) snapshot.tasks.unshift(task);
    });
  }

  /**
   * Starts the waiting task now. The page shows the real task when the host returns it; a failure
   * puts the text back in an empty composer.
   */
  async function commit(): Promise<AgentTask | null> {
    const start = pending;
    if (!start) return null;
    pending = null;
    clearTimeout(start.timer);
    const current = generation;
    try {
      const task = await props.source.start(
        { agentId: start.task.agentId, text: start.text, clientMessageId: start.clientMessageId },
        start.serverId,
      );
      if (current !== generation) return task;
      rememberTask(task);
      setState((draft) => {
        if (draft.pending?.id === start.task.id) draft.pending = null;
        if (draft.took?.taskId === start.task.id) draft.took = { taskId: task.id, pending: false };
        if (draft.selectedId === start.task.id) draft.selectedId = task.id;
      });
      return task;
    } catch (error) {
      if (current !== generation) {
        toastError(error, "conversation.tasks.error.start");
        return null;
      }
      const { t, errorMessage } = currentText();
      setState((draft) => {
        if (draft.pending?.id === start.task.id) draft.pending = null;
        if (draft.took?.taskId === start.task.id) draft.took = null;
        if (draft.selectedId === start.task.id) draft.selectedId = null;
        if (!draft.draft.trim()) {
          draft.draft = start.text;
          draft.agentId = start.task.agentId;
          draft.focusRequest += 1;
        }
        draft.startError = errorMessage(error, t("conversation.tasks.error.start"));
      });
      return null;
    }
  }

  /** A start leaves the page at once: a send before it, the page closing, or a server change. */
  function commitNow(): void {
    if (pending) void commit();
  }

  function start(text: string): boolean {
    const title = plainTaskTitle(text);
    const owner = agentId();
    if (!title || !owner) return false;
    commitNow();
    const clientMessageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: `pending:${clientMessageId}`,
      agentId: owner,
      threadId: "",
      origin: "user",
      title: title.slice(0, TITLE_LIMIT),
      state: "queued",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: [],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    pending = {
      task,
      text,
      clientMessageId,
      serverId: props.serverId,
      timer: setTimeout(() => void commit(), UNDO_MS),
    };
    setState((draft) => {
      draft.pending = task;
      draft.took = { taskId: task.id, pending: true };
      draft.draft = "";
      draft.startError = null;
    });
    return true;
  }

  /** Takes the waiting start back: its text and agent return to the composer. */
  function undo(): void {
    const start = pending;
    if (!start) return;
    pending = null;
    clearTimeout(start.timer);
    setState((draft) => {
      draft.pending = null;
      draft.took = null;
      if (draft.selectedId === start.task.id) draft.selectedId = null;
      draft.draft = start.text;
      draft.agentId = start.task.agentId;
      draft.focusRequest += 1;
    });
  }

  /** A waiting task opens as soon as it starts; the panel shows it as queued until then. */
  function select(taskId: string | null): void {
    setState((draft) => {
      draft.selectedId = taskId;
    });
    if (taskId && taskId === pending?.task.id) void commit();
  }

  async function runAction(action: () => Promise<unknown>, fallback: AppTextKey): Promise<boolean> {
    const current = generation;
    try {
      await action();
      return true;
    } catch (error) {
      if (current === generation) toastError(error, fallback);
      return false;
    }
  }

  const voiceControls: TasksVoiceControls = {
    serverId: () => props.serverId,
    draft: () => state.draft,
    setDraft: (text) =>
      setState((draft) => {
        draft.draft = text;
      }),
    start,
    showError: (message) =>
      setState((draft) => {
        draft.startError = message;
      }),
    focus: () =>
      setState((draft) => {
        draft.focusRequest += 1;
      }),
  };
  const voice = untrack(() => props.voice?.(voiceControls));

  // The page stays open when the user switches the server, so the tasks clear, load and listen again.
  createEffect(
    () => props.serverId,
    (serverId) => {
      setState((draft) => {
        draft.snapshots = {};
        draft.conversations = {};
        draft.pending = null;
        draft.selectedId = null;
        draft.took = null;
        // Agent IDs can repeat on two servers, so the new server starts from its own saved agent.
        draft.agentId = "";
      });
      untrack(() => loadLists(props.agents.map((agent) => agent.id)));
      const unsubscribe = props.source.onEvent(serverId, applyEvent, () =>
        loadLists(props.agents.map((agent) => agent.id)),
      );
      return () => {
        // A waiting start goes to the server it was sent on.
        commitNow();
        generation++;
        unsubscribe();
      };
    },
  );

  // A new agent loads its list; the agents that loaded keep theirs.
  createEffect(
    () => props.agents.map((agent) => agent.id),
    (ids) => {
      const missing = ids.filter((id) => !untrack(() => state.snapshots[id]) && !listRequests.has(id));
      if (missing.length > 0) untrack(() => loadLists(missing));
    },
  );

  // The opened task reads its whole conversation; events keep it current after that.
  createEffect(
    () => {
      const taskId = state.selectedId;
      return taskId && !taskId.startsWith("pending:") ? taskId : null;
    },
    (taskId) => {
      if (!taskId) return;
      untrack(() => {
        const task = taskOf(taskId);
        if (task) readTask(task);
      });
    },
  );

  onCleanup(() => {
    commitNow();
    generation++;
  });

  function panel(taskId: string) {
    const task = () => taskOf(taskId) ?? null;
    const owner = () => agentOf(task()?.agentId ?? "");
    /** Reconciled by id, so a stream chunk redraws only the message that changed. */
    const messages = createProjection<AgentMessage[]>(
      () => {
        const conversation = state.conversations[taskId];
        return conversation ? toAgentMessages(conversation.messages, task()?.agentId) : [];
      },
      [],
      { key: "id" },
    );
    const input = () => {
      const current = task();
      return current && !current.id.startsWith("pending:") ? { agentId: current.agentId, taskId: current.id } : null;
    };
    const approval = () => {
      const current = task();
      return current ? taskApproval(current, props.approvals) : undefined;
    };
    return (
      <Show when={owner() ?? props.agents[0]}>
        {(agent) => (
          <AgentTaskPanel
            task={task()}
            limit={state.snapshots[task()?.agentId ?? ""]?.limit ?? 1}
            agent={agent()}
            agents={props.agents}
            messages={messages}
            onSend={async (text) => {
              const target = input();
              if (!target) return false;
              return runAction(
                () =>
                  props.source.send(
                    { ...target, text, clientMessageId: crypto.randomUUID() },
                    untrack(() => props.serverId),
                  ),
                "conversation.tasks.error.send",
              );
            }}
            onStop={() => {
              const target = input();
              if (target)
                void runAction(() => props.source.stop(target, props.serverId), "conversation.tasks.error.stop");
            }}
            onCloseTask={() => {
              const target = input();
              if (target)
                void runAction(() => props.source.close(target, props.serverId), "conversation.tasks.error.close");
            }}
            onReopen={() => {
              const target = input();
              if (target)
                void runAction(() => props.source.reopen(target, props.serverId), "conversation.tasks.error.reopen");
            }}
            onClosePanel={() => select(null)}
            onOpenLink={props.onOpenLink}
            onPreview={(attachment) => props.onAttachmentAction(attachment, "open")}
            onAttachmentAction={props.onAttachmentAction}
            approval={approval()}
            onRespondApproval={async (decision) => {
              const current = approval();
              return current ? props.onRespondApproval(current, decision) : false;
            }}
          />
        )}
      </Show>
    );
  }

  const took = () => {
    const current = state.took;
    const task = current ? taskOf(current.taskId) : undefined;
    return current && task ? { task, pending: current.pending } : null;
  };

  return (
    <TasksPage
      hostName={props.hostName}
      onBack={props.onBack}
      agentsOpen={props.agentsOpen}
      onToggleAgents={props.onToggleAgents}
      agents={props.agents}
      tasks={tasks()}
      // A list that did not load keeps its agent out, so a failed load does not show the empty page.
      // With no agents yet, the agent list did not load.
      loaded={props.agents.length > 0 && props.agents.every((agent) => state.snapshots[agent.id] !== undefined)}
      agentId={agentId()}
      onAgentChange={(id) => {
        writeAgentSelection(TASK_AGENT_STORAGE_KEY, props.serverId, id);
        setState((draft) => {
          draft.agentId = id;
        });
      }}
      draft={state.draft}
      onDraftChange={voiceControls.setDraft}
      focusRequest={state.focusRequest}
      startError={state.startError}
      onDismissStartError={() =>
        setState((draft) => {
          draft.startError = null;
        })
      }
      onStart={() => {
        if (voice?.phase === "recording") voice.submit();
        else start(state.draft);
      }}
      voice={voice}
      took={took()}
      onTookAgentChange={(id) => {
        if (!pending) return;
        pending.task = { ...pending.task, agentId: id };
        writeAgentSelection(TASK_AGENT_STORAGE_KEY, props.serverId, id);
        setState((draft) => {
          if (draft.pending) draft.pending.agentId = id;
          draft.agentId = id;
        });
      }}
      onUndo={undo}
      onOpenTook={() => {
        const current = state.took;
        if (current) select(current.taskId);
      }}
      onDismissTook={() =>
        setState((draft) => {
          draft.took = null;
        })
      }
      selectedId={state.selectedId}
      waitsForApproval={(task) => taskApproval(task, props.approvals) !== undefined}
      onSelect={select}
      panel={panel}
    />
  );
}
