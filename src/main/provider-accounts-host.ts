// The provider accounts of this host for an administrator of a joined server (`provider-accounts-v1`).

import { type AgentProviderId, DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { PROVIDER_ACCOUNTS_MESSAGE_LIMIT } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit, Option, Semaphore } from "effect";
import { providerLabel } from "../backend/agent/thread-items";
import type { AgentService } from "../backend/agent-service";
import type { BrowserHost } from "../backend/browser-host";
import { type HostSignInPageMode, HostSignInPages } from "./host-sign-in-pages";

export interface ProviderAccountsHostDependencies {
  service: Pick<
    AgentService,
    | "getStatus"
    | "getProviderAccountUsage"
    | "listAgents"
    | "updateAgent"
    | "signInProviderAccountOnHost"
    | "renameProviderAccount"
    | "removeProviderAccount"
  >;
  browser: Pick<BrowserHost, "openPrivate" | "privateTab" | "close">;
}

/**
 * The accounts of this host's providers, for an administrator who is not at this computer.
 *
 * The sign-in of an account opens its page in a private tab of this host's browser, and the
 * administrator signs in through the live view of that tab: the provider sends the grant to a
 * listener on this host. `startSignIn` returns at once; the client reads `signInStatus` until the
 * sign-in ends. One account sign-in runs for each provider: a second start replaces the first.
 */
export class ProviderAccountsHost {
  readonly #dependencies: ProviderAccountsHostDependencies;
  readonly #pages: HostSignInPages<AgentProviderId, { error: string | null }>;
  /** One start at a time, so each start stops the sign-in that it replaces. */
  readonly #starting = Semaphore.makeUnsafe(1);

  constructor(dependencies: ProviderAccountsHostDependencies) {
    this.#dependencies = dependencies;
    this.#pages = new HostSignInPages(dependencies.browser);
  }

  /** The accounts of each provider that can hold more than one, and the agents on an account after the first. */
  list() {
    const providers = (this.#dependencies.service.getStatus().providers ?? []).flatMap((row) =>
      row.accounts
        ? [
            {
              provider: row.id,
              accounts: row.accounts.map((account) => ({
                ...account,
                message: account.message?.slice(0, PROVIDER_ACCOUNTS_MESSAGE_LIMIT) ?? null,
              })),
            },
          ]
        : [],
    );
    const agents = this.#dependencies.service
      .listAgents()
      .flatMap((agent) =>
        agent.providerAccountId && agent.providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID
          ? [{ agentId: agent.id, accountId: agent.providerAccountId }]
          : [],
      );
    return { providers, agents };
  }

  /** The readings of the accounts after the first. The released usage routes give the provider's own. */
  readonly usage = Effect.fn("ProviderAccountsHost.usage")(function* (this: ProviderAccountsHost) {
    return yield* this.#dependencies.service.getProviderAccountUsage();
  }).bind(this);

  /** The sign-in it replaces ends first, so that account does not stay connecting where no cancel reaches it. */
  startSignIn(provider: AgentProviderId, accountId: string | null, mode: HostSignInPageMode = "tab") {
    return this.#pages.interrupt(provider).pipe(
      Effect.andThen(
        this.#pages.start(
          provider,
          (openPage) => this.#dependencies.service.signInProviderAccountOnHost(provider, accountId, openPage),
          (exit) => resultOf(provider, exit),
          mode,
        ),
      ),
      (start) => this.#starting.withPermit(start),
    );
  }

  /** Starts the sign-in with no tab: the page address waits for a client to open it (`provider-account-relay-v1`). */
  startRelay(provider: AgentProviderId, accountId: string | null) {
    return this.startSignIn(provider, accountId, "relay");
  }

  /** The page address of a relayed sign-in, and how it ended. */
  relayStatus(provider: AgentProviderId): { pageUrl: string | null; result: { error: string | null } | null } {
    return { pageUrl: this.#pages.pageUrl(provider), result: this.signInStatus(provider).result };
  }

  signInStatus(provider: AgentProviderId) {
    return this.#pages.status(provider) ?? { tabId: null, result: { error: endedText(provider) } };
  }

  /** The interrupt ends the sign-in, and a new account that did not sign in goes with it. */
  cancelSignIn(provider: AgentProviderId) {
    return this.#pages.interrupt(provider);
  }

  rename(provider: AgentProviderId, accountId: string, label: string | null) {
    return this.#dependencies.service.renameProviderAccount(provider, accountId, label).pipe(Effect.asVoid);
  }

  remove(provider: AgentProviderId, accountId: string) {
    return this.#dependencies.service.removeProviderAccount(provider, accountId).pipe(Effect.asVoid);
  }

  /** Moves the agent to an account of its provider; null is the provider's own sign-in. */
  setAgentAccount(agentId: string, accountId: string | null) {
    return this.#dependencies.service.updateAgent({ agentId, providerAccountId: accountId }).pipe(Effect.asVoid);
  }

  close() {
    return this.#pages.close();
  }
}

function endedText(provider: AgentProviderId): string {
  return sourceText("error.provider.hostSignInEnded", { provider: providerLabel(provider) });
}

function resultOf(provider: AgentProviderId, exit: Exit.Exit<void, { cause: unknown }>): { error: string | null } {
  if (Exit.isSuccess(exit)) return { error: null };
  const failure = Cause.findErrorOption(exit.cause);
  const cause = Option.isSome(failure) ? failure.value.cause : undefined;
  return {
    error: (cause instanceof Error ? cause.message : endedText(provider)).slice(0, PROVIDER_ACCOUNTS_MESSAGE_LIMIT),
  };
}
