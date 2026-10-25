import { type AgentSummary, DEFAULT_PROVIDER_ACCOUNT_ID, isFreeOpencodeModel } from "@openbot/contracts/ipc";

/** How an agent's turns are paid for. `custom` is an endpoint the user added, local or remote. */
export const PROVIDER_AUTH_KINDS = ["subscription", "api_key", "free", "custom", "unknown"] as const;
export type ProviderAuthKind = (typeof PROVIDER_AUTH_KINDS)[number];

export interface ProviderAuthFacts {
  /** The type and plan of the provider's own sign-in, as its CLI reports them. */
  account: (provider: AgentSummary["provider"]) => { type: string; planType: string | null } | null;
  hasApiKey: (provider: AgentSummary["provider"]) => boolean;
  customProviderIds: () => readonly string[];
  /** Whether the main process environment, which the provider CLIs inherit, sets the key. */
  envKey: (name: "XAI_API_KEY" | "CURSOR_API_KEY") => boolean;
}

/**
 * Reads only what the host already holds; nothing here calls a provider. A case it cannot tell
 * apart is `unknown`, never a guess: OpenCode and Pi can run any model with the user's own keys.
 */
export function providerAuthKind(agent: AgentSummary, facts: ProviderAuthFacts): ProviderAuthKind {
  const model: string = agent.model;
  // The host reads the plan of the provider's own sign-in only; an added account stores no plan.
  const addedAccount = agent.providerAccountId !== undefined && agent.providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID;
  switch (agent.provider) {
    case "codex": {
      if (addedAccount) return "unknown";
      const account = facts.account("codex");
      if (account?.type !== "chatgpt") return "unknown";
      return account.planType === "free" ? "free" : "subscription";
    }
    case "claude":
      if (addedAccount) return "unknown";
      return facts.account("claude")?.planType ? "subscription" : "unknown";
    case "grok":
      // With a key set, the CLI picks the method it advertises, which the host does not see.
      if (facts.envKey("XAI_API_KEY")) return "unknown";
      return facts.account("grok") ? "subscription" : "unknown";
    case "antigravity":
      return facts.hasApiKey("antigravity") ? "api_key" : "subscription";
    case "muse":
      if (facts.hasApiKey("muse")) return "api_key";
      return facts.account("muse") ? "subscription" : "unknown";
    case "inception":
      return facts.hasApiKey("inception") ? "api_key" : "unknown";
    case "cursor":
      if (facts.envKey("CURSOR_API_KEY")) return "api_key";
      return facts.account("cursor") ? "subscription" : "unknown";
    case "cline":
      return model.startsWith("cline-free/") ? "free" : "unknown";
    case "opencode": {
      const prefix = model.slice(0, Math.max(0, model.indexOf("/")));
      if (prefix && facts.customProviderIds().includes(prefix)) return "custom";
      if (isFreeOpencodeModel(model, model)) return "free";
      // The stored key is an OpenCode Go key, and Go is a plan: the key and the user's own OpenCode
      // sign-in both buy `opencode-go/`. A paid `opencode/` model comes only from the user's own sign-in.
      return prefix === "opencode-go" ? "subscription" : "unknown";
    }
    default:
      return "unknown";
  }
}
