import { developmentStartingModel } from "@openbot/contracts/development-defaults";
import {
  type AgentModelId,
  type AgentProviderId,
  type AppSetupState,
  type ClientAgentModelOption,
  defaultProviderModel,
  PICKER_PROVIDERS,
} from "@openbot/contracts/ipc";

/**
 * The provider, and the model, that a new agent starts on when the catalog lists them: the saved
 * setup choice of this computer, or the choice of a joined server's provider step.
 */
export type CreationPreference = Pick<AppSetupState, "preferredProvider" | "preferredModel">;

export interface CreationModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/**
 * A development build's local server: which providers can run a turn now, read from the same
 * status rows the backend reads for its own development default.
 */
export interface DevelopmentCreation {
  providerAvailable: (provider: AgentProviderId) => boolean;
}

/**
 * The provider and model a new-agent draft starts on: the saved setup choice when the live
 * catalog still lists it, else that provider's default when listed, else its first listed model,
 * else the first provider in picker order with any model. `null` while the catalog is empty.
 *
 * Seeding from the saved choice matters because the form always submits a pair: a hard-coded
 * default would bypass the backend's saved-provider default and fail outright after onboarding
 * with a provider the default does not cover.
 *
 * With `development` and no saved choice beyond the built-in Codex, the form starts on the
 * backend's development default, and then only on a provider that can run, as `startingChoice`
 * does: the form submits its pair, so the backend default never applies to it.
 */
export function resolveCreationModel(
  setup: CreationPreference | null,
  modelOptions: ClientAgentModelOption[],
  development: DevelopmentCreation | null = null,
): CreationModelChoice | null {
  const preferred = setup?.preferredProvider ?? null;
  const developmentStart = development !== null && (preferred ?? "codex") === "codex" && !setup?.preferredModel;
  const start = developmentStartingModel({
    enabled: developmentStart,
    models: modelOptions,
    providerAvailable: (provider) => development?.providerAvailable(provider) ?? false,
  });
  if (start) return { provider: start.provider, model: start.model.id };
  const ordered: AgentProviderId[] = preferred
    ? [preferred, ...PICKER_PROVIDERS.filter((provider) => provider !== preferred)]
    : [...PICKER_PROVIDERS];
  for (const provider of ordered) {
    if (developmentStart && !development?.providerAvailable(provider)) continue;
    const options = modelOptions.filter((option) => option.provider === provider);
    if (options.length === 0) continue;
    if (provider === preferred && setup?.preferredModel) {
      const kept = options.find((option) => option.id === setup.preferredModel);
      if (kept) return { provider, model: kept.id };
    }
    const fallback = options.find((option) => option.id === defaultProviderModel(provider)) ?? options[0];
    if (fallback) return { provider, model: fallback.id };
  }
  return null;
}
