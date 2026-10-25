import type { AgentApproval, AgentEvent } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { SidebarApproval, SidebarAttention } from "@openbot/ui/features/sidebar/sidebar-agent-states";

type AttentionEvent = Extract<AgentEvent, { type: "prompt" } | { type: "browser-takeover-requested" }>;

export interface AgentThreadAttentionInput {
  agents: readonly Pick<AgentProfile, "id" | "threadId">[];
  pendingPrompts: Record<string, AttentionEvent | undefined>;
  approvals: readonly AgentApproval[];
}

/**
 * The prompts and approvals of each agent's own thread. A wait in a channel or task thread stays
 * out, because the agent's chat cannot answer it.
 */
export function agentThreadAttention(input: AgentThreadAttentionInput): {
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, SidebarApproval | undefined>;
} {
  const agentThreads = new Map(input.agents.map((agent) => [agent.id, agent.threadId]));
  const inAgentThread = (agentId: string, threadId: string | undefined) =>
    threadId !== undefined && agentThreads.get(agentId) === threadId;
  return {
    pendingPrompts: Object.fromEntries(
      Object.entries(input.pendingPrompts).filter(([agentId, event]) =>
        inAgentThread(agentId, event?.type === "prompt" ? event.threadId : event?.request.threadId),
      ),
    ),
    pendingApprovals: Object.fromEntries(
      input.approvals
        .filter((approval) => inAgentThread(approval.agentId, approval.threadId))
        .map((approval) => [approval.agentId, approval]),
    ),
  };
}
