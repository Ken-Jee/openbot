// The Cursor plan usage, read from the Cursor backend with the Cursor CLI's own sign-in.
//
// Cursor's ACP process does not report usage, so this is the request the Cursor CLI sends itself:
// `aiserver.v1.DashboardService/GetCurrentPeriodUsage` on its API endpoint, as Connect JSON, with
// the access token of the CLI's sign-in. The answer splits the plan into Cursor's own models
// (`autoPercentUsed`) and every other model (`apiPercentUsed`) for one billing cycle.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Option, Schema } from "effect";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord } from "./protocol";

/** The CLI's default endpoint. `CURSOR_API_ENDPOINT` moves the CLI, so it moves this read too. */
const CURSOR_API_ENDPOINT = "https://api2.cursor.sh";
const CURRENT_PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CURSOR_USAGE_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;

const execFileAsync = promisify(execFile);

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

/**
 * No sign-in file, a token the backend rejects, and a plan with no percentages all read as no
 * usage, so the dock shows the provider as not reporting instead of an error.
 */
class CursorUsageFailed extends Schema.TaggedError<CursorUsageFailed>()("CursorUsageFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * The file where the Cursor CLI keeps its sign-in. On macOS the CLI uses the login Keychain and
 * writes this file only when the Keychain cannot be used.
 */
export function cursorAuthFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  switch (platform()) {
    case "win32":
      return join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "auth.json");
    case "darwin":
      return join(home, ".cursor", "auth.json");
    default:
      return join(env.XDG_CONFIG_HOME || join(home, ".config"), "cursor", "auth.json");
  }
}

const CursorAuth = Schema.Struct({ accessToken: Schema.NonEmptyString });

const readAccessToken = Effect.fn("Cursor.readAccessToken")(function* () {
  if (platform() === "darwin") {
    // The CLI writes the item with `/usr/bin/security`, so reading it with the same tool asks nothing.
    const keychain = yield* Effect.tryPromise({
      try: () =>
        execFileAsync(
          "/usr/bin/security",
          ["find-generic-password", "-a", "cursor-user", "-s", "cursor-access-token", "-w"],
          { timeout: KEYCHAIN_TIMEOUT_MS },
        ),
      catch: (cause) => new CursorUsageFailed({ cause }),
    }).pipe(Effect.option);
    const token = Option.isSome(keychain) ? keychain.value.stdout.trim() : "";
    if (token) return token;
  }
  const text = yield* Effect.tryPromise({
    try: () => readFile(cursorAuthFile(), "utf8"),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  if (Option.isNone(text)) return null;
  const auth = Schema.decodeUnknownOption(Schema.fromJsonString(CursorAuth))(text.value);
  return Option.isSome(auth) ? auth.value.accessToken : null;
});

export const readCursorUsage = Effect.fn("Cursor.readUsage")(function* () {
  const accessToken = yield* readAccessToken();
  if (!accessToken) return NO_USAGE;
  const endpoint = process.env.CURSOR_API_ENDPOINT?.trim() || CURSOR_API_ENDPOINT;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            // Appended, not resolved: a resolved absolute path drops a path in the endpoint.
            fetch(`${endpoint.replace(/\/+$/u, "")}${CURRENT_PERIOD_USAGE_PATH}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: "{}",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CURSOR_USAGE_TIMEOUT_MS)]),
            }),
          catch: (cause) => new CursorUsageFailed({ cause }),
        });
        if (response.status === 401 || response.status === 403) return NO_USAGE;
        if (!response.ok)
          return yield* new CursorUsageFailed({
            cause: new Error(`Cursor usage returned HTTP ${response.status}.`),
          });
        const body = yield* Effect.tryPromise({
          try: (): Promise<unknown> => response.json(),
          catch: (cause) => new CursorUsageFailed({ cause }),
        });
        return cursorRateLimits(body);
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

/** Connect JSON writes an int64 as a string. */
const Int64 = Schema.Union([Schema.Finite, Schema.FiniteFromString]);
const CurrentPeriodUsage = Schema.Struct({
  billingCycleStart: Schema.optional(Int64),
  billingCycleEnd: Schema.optional(Int64),
});
const PlanUsage = Schema.Struct({
  autoPercentUsed: Schema.optional(Schema.Finite),
  apiPercentUsed: Schema.optional(Schema.Finite),
  totalPercentUsed: Schema.optional(Schema.Finite),
});

/**
 * The primary window holds Cursor's own models and the secondary one every other model; the dock
 * names them by slot. A plan that reports only the total fills the primary window with it.
 */
function cursorRateLimits(value: unknown): AccountRateLimitsReadResult {
  const period = Schema.decodeUnknownOption(CurrentPeriodUsage)(value);
  const plan = Schema.decodeUnknownOption(PlanUsage)(getRecord(value, "planUsage") ?? {});
  if (Option.isNone(period) || Option.isNone(plan)) return NO_USAGE;
  const { billingCycleStart, billingCycleEnd } = period.value;
  const cycle = {
    windowDurationMins:
      billingCycleStart !== undefined && billingCycleEnd !== undefined && billingCycleEnd > billingCycleStart
        ? Math.round((billingCycleEnd - billingCycleStart) / 60_000)
        : null,
    resetsAt: billingCycleEnd ? billingCycleEnd / 1_000 : null,
  };
  const window = (usedPercent: number | undefined): AccountRateLimitWindowResult | null =>
    usedPercent === undefined ? null : { usedPercent: Math.max(0, Math.min(100, usedPercent)), ...cycle };
  const { autoPercentUsed, apiPercentUsed, totalPercentUsed } = plan.value;
  const split = autoPercentUsed !== undefined || apiPercentUsed !== undefined;
  const primary = window(split ? autoPercentUsed : totalPercentUsed);
  const secondary = split ? window(apiPercentUsed) : null;
  if (!primary && !secondary) return NO_USAGE;
  return { rateLimits: { limitId: "cursor", primary, secondary }, rateLimitsByLimitId: null };
}
