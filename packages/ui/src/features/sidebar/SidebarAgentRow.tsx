/**
 * One agent in a section: the drag wrapper, the row itself, and its context menu.
 *
 * A waiting agent's row sits in the "Needs you" group instead. There it does not drag, because the
 * group is not a place in the layout, and its tooltip says what the agent waits for.
 *
 * A hidden agent's row sits in the "Hidden" group. It does not drag either. It sleeps, shows no state,
 * and shows when the user hid it in place of the last message.
 */

import { AppWindow, Badge, buttonVariants, Clock3, ContextMenu, Lock, Tooltip } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createStore, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { agentAccessLockLabel } from "../agents/agent-access";
import { SidebarAgentContextMenu } from "./SidebarAgentContextMenu";
import { SidebarAgentIndicator, SidebarWaitIcon } from "./SidebarAgentIndicator";
import {
  SIDEBAR_WAIT_ACTION,
  SIDEBAR_WAIT_HINT,
  SIDEBAR_WAIT_TITLE,
  sidebarAgentStateLabel,
  sidebarMessageTime,
  sidebarUsageResetTime,
} from "./sidebar-filtering";
import { useSidebarScope } from "./sidebar-scope";

/** Long enough that moving the pointer down the list does not flash every waiting row's tooltip. */
const SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY = 350;

/**
 * `waiting` is set by the "Needs you" group. The row reads it rather than the agent's state, because
 * the group holds its members still during a drag while the state moves on. `userHidden` is set by
 * the "Hidden" group.
 */
export function SidebarAgentRow(rowProps: { agent: AgentProfile; waiting?: boolean; userHidden?: boolean }) {
  const {
    dragOffset,
    draggedChatId,
    endChatDragging,
    layoutMutable,
    props,
    sidebarClickIsSuppressed,
    startChatDragging,
    userHiddenSince,
  } = useSidebarScope();
  const { t, format } = useText();
  const title = () => rowProps.agent.title.trim();
  const lockLabel = () => agentAccessLockLabel(rowProps.agent, t);
  const accessLabel = () => (lockLabel() ? `. ${lockLabel()}` : "");
  const inWindow = () => props.windowAgentIds?.has(rowProps.agent.id) ?? false;
  const windowLabel = () => (inWindow() ? `. ${t("sidebar.agentMenu.inWindow")}` : "");
  const state = () => (rowProps.userHidden ? undefined : props.agentStates[rowProps.agent.id]);
  const hiddenDetail = () => {
    const since = rowProps.userHidden ? userHiddenSince(rowProps.agent.id) : undefined;
    return since
      ? t("sidebar.hidden.since", { date: format.date(new Date(since), { month: "short", day: "numeric" }) })
      : "";
  };
  const detail = () => hiddenDetail() || rowProps.agent.preview;
  // A function, not a JSX ternary: the compiler wraps a ternary in a memo, and the avatar reads its
  // mood inside an effect, where a memo cannot be created.
  const mood = () => (rowProps.userHidden ? "asleep" : (props.agentMoods[rowProps.agent.id] ?? "idle"));
  const hiddenLabel = () => (rowProps.userHidden ? `${t("sidebar.hidden.title")}. ` : "");
  const draggable = () => layoutMutable() && !props.compact && !rowProps.waiting && !rowProps.userHidden;
  const wait = () => {
    const current = state();
    return rowProps.waiting && current?.kind === "waiting" ? current : undefined;
  };
  const [overlay, setOverlay] = createStore({ tooltipOpen: false, menuOpen: false });
  const limit = () => {
    const current = state();
    return current?.kind === "limited" ? current : undefined;
  };
  const stateLabel = () => {
    const current = state();
    return current?.kind === "routine" || current?.kind === "waiting" || current?.kind === "limited"
      ? sidebarAgentStateLabel(current, t, format)
      : "";
  };
  const routineLabel = () => (state()?.kind === "routine" || limit() ? stateLabel() : "");
  // Only a waiting row has a tooltip, so the rows in the sections do not each carry one.
  const row = (): JSX.Element => (
    <ContextMenu.Root
      modal={false}
      onOpenChange={(open) =>
        setOverlay((draft) => {
          draft.menuOpen = open;
        })
      }
    >
      <ContextMenu.Trigger
        as="button"
        type="button"
        class={[
          buttonVariants({ variant: "ghost" }),
          "agent-row",
          {
            "agent-row-active": props.activeAgentId === rowProps.agent.id,
            "sidebar-agent-row-dragging": draggedChatId() === rowProps.agent.id,
          },
        ]}
        aria-label={`${rowProps.agent.name}${title() ? `, ${title()}` : ""}${accessLabel()}${windowLabel()}. ${hiddenLabel()}${detail()}${stateLabel() ? `. ${stateLabel()}` : ""}`}
        title={routineLabel() || undefined}
        aria-pressed={props.activeAgentId === rowProps.agent.id ? "true" : "false"}
        data-cuelume-navigate=""
        onClick={(event: MouseEvent) => {
          if (!sidebarClickIsSuppressed(event)) props.onSelectAgent(rowProps.agent.id);
        }}
      >
        <span class="agent-row-avatar">
          <AgentAvatar agent={rowProps.agent} motion="idle" mood={mood()} />
          <SidebarAgentIndicator state={state} />
        </span>
        <span class="agent-row-copy">
          <span class="agent-row-heading">
            <span class="agent-row-title">
              <span class="agent-row-name">
                <strong>{rowProps.agent.name}</strong>
                <Show when={lockLabel()}>
                  <span class="agent-row-access" title={lockLabel()}>
                    <Lock aria-hidden="true" />
                  </span>
                </Show>
                <Show when={inWindow()}>
                  <span class="agent-row-access" title={t("sidebar.agentMenu.inWindow")}>
                    <AppWindow aria-hidden="true" />
                  </span>
                </Show>
              </span>
              <Show when={title()}>
                {(label) => (
                  <Badge class="agent-role-badge" title={label()}>
                    <span>{label()}</span>
                  </Badge>
                )}
              </Show>
            </span>
            <Show
              when={wait()}
              fallback={
                <Show
                  when={limit()}
                  fallback={
                    <Show when={!rowProps.userHidden}>
                      <span class="agent-row-time">
                        {rowProps.agent.updatedAt
                          ? sidebarMessageTime(rowProps.agent.updatedAt, format)
                          : rowProps.agent.time}
                      </span>
                    </Show>
                  }
                >
                  {(current) => (
                    <span class="agent-row-wait-chip">
                      <Clock3 aria-hidden="true" />
                      {sidebarUsageResetTime(current().resetsAt, format) ?? t("sidebar.state.usageLimitChip")}
                    </span>
                  )}
                </Show>
              }
            >
              {(current) => (
                <span class="agent-row-wait-chip">
                  <SidebarWaitIcon reason={current().reason} />
                  {t(SIDEBAR_WAIT_ACTION[current().reason])}
                </span>
              )}
            </Show>
          </span>
          <span class="agent-row-preview">{detail()}</span>
        </span>
        <Show when={state()}>
          {(state) => <span class="sr-only">{sidebarAgentStateLabel(state(), t, format)}</span>}
        </Show>
      </ContextMenu.Trigger>
      <SidebarAgentContextMenu agent={rowProps.agent} pinned={false} userHidden={rowProps.userHidden === true} />
    </ContextMenu.Root>
  );
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: Native drag belongs to the wrapper around the accessible button. */
    <div
      class={[
        "sidebar-agent-item",
        {
          "sidebar-agent-item-user-hidden": rowProps.userHidden === true,
          "sidebar-agent-item-dragging": draggedChatId() === rowProps.agent.id,
          "sidebar-drag-shifting": dragOffset(rowProps.agent.id).y !== 0,
        },
      ]}
      style={`--sidebar-drag-y: ${dragOffset(rowProps.agent.id).y}px;`}
      data-chat-id={rowProps.waiting || rowProps.userHidden ? undefined : rowProps.agent.id}
      draggable={draggable() ? "true" : "false"}
      onDragStart={(event: DragEvent & { currentTarget: HTMLElement }) => startChatDragging(event, rowProps.agent.id)}
      onDragEnd={endChatDragging}
    >
      <Show when={wait()} fallback={row()}>
        {(current) => (
          <Tooltip.Root
            open={overlay.tooltipOpen && !overlay.menuOpen}
            onOpenChange={(open) =>
              setOverlay((draft) => {
                draft.tooltipOpen = open;
              })
            }
            placement="right"
            gutter={10}
            openDelay={SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY}
            closeDelay={0}
            skipDelayDuration={300}
          >
            <Tooltip.Trigger as="div" class="sidebar-agent-tooltip-trigger">
              {row()}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="sidebar-wait-tooltip">
                <span class="sidebar-wait-tooltip-title">
                  <SidebarWaitIcon reason={current().reason} />
                  {t(SIDEBAR_WAIT_TITLE[current().reason])}
                </span>
                <Show when={current().detail}>
                  {(detail) => <span class="sidebar-wait-tooltip-detail">{detail()}</span>}
                </Show>
                <span class="sidebar-wait-tooltip-hint">{t(SIDEBAR_WAIT_HINT[current().reason])}</span>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </Show>
    </div>
  );
}
