// Checks that a provider error moves an agent set to switch without asking to its next backup model,
// and that read_agent shows the move (#2834). Runs the real agent service on a temporary profile. Claude is the real `ClaudeAgentClient`,
// which the Claude Agent SDK connects to a stand-in `claude` executable. The stand-in answers each
// message on its current model, and fails it with the CLI's report of an Anthropic overload (529)
// when that model is in `failing.json`. A message with `act-then-fail` writes text before it fails.
// Checks:
//   1. A turn that wrote text before the error does not move: it fails with its error, as before.
//   2. An agent with no backup models fails with its error, as before.
//   3. A turn that did nothing yet runs again on the backup model, with a note and no error.
//   4. read_agent shows the backup model, and the model to go back to with the provider error as cause.
//   5. After a restart, the agent goes back to its own model, with a note.
// `bun run test:backup-model-failover`. Writes .openbot-build/backup-model-failover-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentModelId,
  defaultProviderModel,
  MODEL_SWITCH_ITEM_TYPES,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient, DiagnosticOrigin } from "../src/backend/agent-client";
import type { ClaudeCliInfo } from "../src/backend/cli";
import type { AppServerNotification, AppServerRequest, RequestId, ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import type { ReadProviderHistory } from "../src/backend/provider-history";

const OUT = resolve(import.meta.dirname, "../.openbot-build/backup-model-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-backup-model-failover-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const turnLog = join(root, "claude-turns.jsonl");
const failingFile = join(root, "failing.json");
const claudeExecutable = join(root, "claude");
const PRIMARY: AgentModelId = defaultProviderModel("claude");
const BACKUP: AgentModelId = PRIMARY === "claude-sonnet-5-5" ? "claude-opus-5-5" : "claude-sonnet-5-5";
// The text the Claude CLI writes in an outage. It names no HTTP status phrase, only the 529 and its type.
const PROVIDER_ERROR =
  'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_e2e"}';

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_CLAUDE_PATH = claudeExecutable;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ClaudeAgentClient } = await import("../src/backend/claude-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// The stand-in for the Claude CLI. It speaks enough of the stream-json protocol for a turn to end,
// and logs the model and the outcome of each turn.
const STAND_IN_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.302 (Claude Code)\\n");
  process.exit(0);
}
const option = (name) => {
  const index = args.findIndex((arg) => arg === name || arg.startsWith(name + "="));
  if (index < 0) return null;
  return args[index] === name ? (args[index + 1] ?? null) : args[index].slice(name.length + 1);
};
const sessionId = option("--resume") ?? option("--session-id") ?? randomUUID();
let model = option("--model");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const result = (fields) =>
  write({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), duration_ms: 1,
    duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 },
    permission_denials: [], modelUsage: {}, ...fields });
const assistant = (text) =>
  write({ type: "assistant", message: { id: "msg_" + randomUUID(), type: "message", role: "assistant", model,
    content: [{ type: "text", text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    parent_tool_use_id: null, session_id: sessionId, uuid: randomUUID() });
const turn = (message) => {
  const failing = JSON.parse(fs.readFileSync(${JSON.stringify(failingFile)}, "utf8"));
  const fails = failing.includes(model);
  const acts = JSON.stringify(message).includes("act-then-fail");
  fs.appendFileSync(${JSON.stringify(turnLog)}, JSON.stringify({ model, failed: fails }) + "\\n");
  if (fails) {
    if (acts) assistant("Partial answer.");
    result({ is_error: true, result: ${JSON.stringify(PROVIDER_ERROR)} });
    return;
  }
  assistant("Done.");
  result({ is_error: false, result: "Done." });
};
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request") {
      if (message.request?.subtype === "set_model") model = message.request.model ?? model;
      write({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    } else if (message.type === "user") turn(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

/**
 * The real Claude client. Only the account, usage and model reads are answered here: the real ones
 * run `claude auth status` or a probe query. It also records the provider thread of the last turn, and
 * keeps the answers to the tool calls this check sends as the provider would.
 */
class ClaudeStandIn extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "claude";
  readonly contextCompaction = "native";
  readonly #real: InstanceType<typeof ClaudeAgentClient>;
  readonly readHistory: ReadProviderHistory;
  /** The provider thread of the last turn that started. */
  lastThread: string | null = null;
  readonly toolAnswers = new Map<RequestId, unknown>();

  constructor(cli: ClaudeCliInfo) {
    super();
    this.#real = new ClaudeAgentClient(cli);
    this.readHistory = this.#real.readHistory;
    this.#real.on("notification", (notification) => {
      if (notification.method === "turn/started" && isDynamicRecord(notification.params)) {
        const threadId = notification.params.threadId;
        if (typeof threadId === "string") this.lastThread = threadId;
      }
      this.emit("notification", notification);
    });
    this.#real.on("request", (request) => this.emit("request", request));
    this.#real.on("diagnostic", (message) => this.emit("diagnostic", message));
    this.#real.on("exit", (error) => this.emit("exit", error));
  }

  get running(): boolean {
    return this.#real.running;
  }

  start(): void {
    this.#real.start();
  }

  stop() {
    return this.#real.stop();
  }

  canReleaseProcess = () => this.#real.canReleaseProcess();

  releaseThread(externalThreadId: string) {
    return this.#real.releaseThread(externalThreadId);
  }

  releaseIdleThreads() {
    return this.#real.releaseIdleThreads();
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number) {
    if (!this.#real.running) return this.#real.request(method, params, decoder, timeoutMs);
    switch (method) {
      case "account/read":
        return providerSync(() => decoder({ account: { type: "claude", email: "claude@example.com" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() =>
          decoder({
            data: [
              { model: PRIMARY, displayName: "Primary" },
              { model: BACKUP, displayName: "Backup" },
            ],
          }),
        );
      default:
        return this.#real.request(method, params, decoder, timeoutMs);
    }
  }

  notify(): void {
    this.#real.notify();
  }

  respond(id: RequestId, result: unknown): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, result);
    else this.#real.respond(id, result);
  }

  respondError(id: RequestId, error: Parameters<AgentClient["respondError"]>[1]): void {
    if (typeof id === "string" && id.startsWith("e2e-tool-")) this.toolAnswers.set(id, { error });
    else this.#real.respondError(id, error);
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail?: unknown;
}

const report: { primary: string; backup: string; checks: Check[]; passed: boolean; error?: string } = {
  primary: PRIMARY,
  backup: BACKUP,
  checks: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service or of its database. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function turns(): { model: string; failed: boolean }[] {
  try {
    return readFileSync(turnLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const failing = (models: string[]) => writeFileSync(failingFile, JSON.stringify(models));

await writeFile(claudeExecutable, STAND_IN_CLAUDE, { mode: 0o755 });
failing([]);
const database = new OpenBotDatabase(userData);
const clients: ClaudeStandIn[] = [];
const events: AgentEvent[] = [];

function startService() {
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    clientFactory: (_provider, cli) => {
      const client = new ClaudeStandIn(cli);
      clients.push(client);
      return client;
    },
  });
  service.on("event", (event) => events.push(event));
  return { store, mailbox, service };
}

let { store, mailbox, service } = startService();

function agentOf(agentId: string) {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Agent ${agentId} exists.`);
  return agent;
}

function errorsFor(agentId: string, since: number) {
  return events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

/** Sends a message and waits for its delivery to end. */
async function send(agentId: string, text: string) {
  const receipt = await runCauseEffect(service.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`"${text}" to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" ? value : null;
  });
  return { status, error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null };
}

/** The name the service lists for a model, which the switch notes show. */
function modelName(model: string): string {
  return service.listModels().find((option) => option.provider === "claude" && option.id === model)?.name ?? model;
}

async function markers(agentId: string, itemType: string) {
  const snapshot = await runCauseEffect(service.readConversation(agentId));
  return snapshot.messages.filter((message) => message.itemType === itemType).map((message) => message.text);
}

/** Calls an OpenBot tool from the thread of the last turn, as its provider would, and returns the answer. */
let toolCalls = 0;
async function callTool(tool: string, args: unknown) {
  const client = clients.at(-1);
  assert.ok(client, "The service made a Claude client.");
  const thread = client.lastThread;
  assert.ok(thread, "A turn ran.");
  const id = `e2e-tool-${++toolCalls}`;
  client.emit("request", {
    id,
    method: "item/tool/call",
    params: { threadId: thread, turnId: "e2e-turn", callId: id, namespace: "openbot", tool, arguments: args },
  });
  const answer = await waitFor(`${tool} to answer`, () => client.toolAnswers.get(id));
  assert.ok(isDynamicRecord(answer) && Array.isArray(answer.contentItems), `${tool} answers with content.`);
  const item = answer.contentItems[0];
  assert.ok(isDynamicRecord(item) && typeof item.text === "string", `${tool} answers with text.`);
  return { success: answer.success === true, text: item.text };
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

try {
  await runCauseEffect(service.initialize());
  const create = (name: string) =>
    runCauseEffect(
      service.createAgent({
        name,
        description: "Checks backup models.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
        provider: "claude",
        model: PRIMARY,
      }),
    );
  const mover = await create("Mover");
  const stayer = await create("Stayer");
  await waitFor(
    "the first turns to end",
    () =>
      turns().length >= 2 &&
      !service
        .listQueue(mover.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)) &&
      !service
        .listQueue(stayer.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status)),
  );
  await runCauseEffect(
    service.updateAgent({
      agentId: mover.id,
      backupModels: { automatic: true, order: [{ provider: "claude", model: BACKUP }] },
    }),
  );
  failing([PRIMARY]);

  await check("a turn that wrote text does not move", async () => {
    const since = events.length;
    const outcome = await send(mover.id, "act-then-fail");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(mover.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(mover.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("an agent with no backup models fails as before", async () => {
    const since = events.length;
    const outcome = await send(stayer.id, "work");
    assert.equal(outcome.status, "failed", "The turn fails.");
    assert.equal(agentOf(stayer.id).model, PRIMARY, "The agent stays on its own model.");
    assert.ok(errorsFor(stayer.id, since).length > 0, "The error shows.");
    return outcome;
  });

  await check("a provider error moves the agent to its backup model", async () => {
    const since = events.length;
    const before = turns().length;
    const outcome = await send(mover.id, "work");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    const ran = turns().slice(before);
    assert.deepEqual(
      ran.map((turn) => turn.model),
      [PRIMARY, BACKUP],
      "The message ran on the own model, then on the backup.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, BACKUP, "The agent is on the backup model.");
    assert.equal(agent.usageLimitReturn?.model, PRIMARY, "The agent keeps its own model to go back to.");
    assert.equal(agent.usageLimitReturn?.cause, "provider-error", "The return names the provider error.");
    assert.deepEqual(errorsFor(mover.id, since), [], "No error shows for the moved turn.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelSwitchedForError", { model: modelName(BACKUP) })]);
    return { ran, notes };
  });

  // `agent-profile-accounts-e2e.ts` checks that update_profile sets and clears the order.
  await check("read_agent shows that a provider error moved the agent", async () => {
    const read = await callTool("read_agent", { agentId: mover.id });
    assert.ok(read.success, read.text);
    const setup = JSON.parse(read.text);
    assert.equal(setup.model, BACKUP, "read_agent shows the backup model.");
    assert.equal(setup.usageLimitReturn?.model, PRIMARY, "read_agent names the model to go back to.");
    assert.equal(setup.usageLimitReturn?.cause, "provider-error", "read_agent names the provider error.");
    return { model: setup.model, usageLimitReturn: setup.usageLimitReturn };
  });

  await check("after a restart the agent goes back to its own model", async () => {
    await runCauseEffect(service.stop());
    failing([]);
    ({ store, mailbox, service } = startService());
    await runCauseEffect(service.initialize());
    const before = turns().length;
    const outcome = await send(mover.id, "again");
    assert.equal(outcome.status, "completed", `The message completes: ${outcome.error}`);
    assert.deepEqual(
      turns()
        .slice(before)
        .map((turn) => turn.model),
      [PRIMARY],
      "The message runs on the own model.",
    );
    const agent = agentOf(mover.id);
    assert.equal(agent.model, PRIMARY, "The agent is back on its own model.");
    assert.equal(agent.usageLimitReturn, undefined, "Nothing is left to go back to.");
    const notes = await markers(mover.id, MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]);
    assert.deepEqual(notes, [sourceText("status.agent.modelReturnedAfterError", { model: modelName(PRIMARY) })]);
    return { notes };
  });

  report.passed = report.checks.length === 5;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
