// Lists and selects Cline's free models end to end on the real Cline driver, with a fake `cline --acp`
// that answers as Cline 3.0.73 does: a provider option of the model category comes before the model
// option, the model option does not list the `cline-free/*` models, and the agent takes any model
// value. Cline's recommended-models endpoint is answered in this process. Checks that the picker gets
// the free models with a "(free)" name, that a listed and a free model each reach the session through
// the `model` option, that a free model moves the session to the `cline` provider, that a list that
// cannot be read gives the last good one, then the bundled one, and that an empty free tier is kept.
// `bun scripts/cline-free-models-e2e.ts`. Writes .openbot-build/cline-free-models-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { CLINE_RECOMMENDED_MODELS_URL } from "../src/backend/cline-free-models";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type AppServerNotification,
  decodeModelListResponse,
  getString,
  type ModelListResponse,
} from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cline-free-models-e2e");

const FAKE_CLINE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const LISTED = [
  { modelId: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { modelId: "openai/gpt-6-astra", name: "GPT-6 Astra" },
];
const PROVIDERS = ["cline", "cline-pass", "openai-codex"];
const sessions = new Map();
let count = 0;
const log = (entry) => fs.appendFileSync(process.env.FAKE_CLINE_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function configOptions(session) {
  return [
    { id: "provider", name: "Provider", category: "model", type: "select", currentValue: session.provider,
      options: PROVIDERS.map((value) => ({ value, name: value })) },
    { id: "model", name: "Model", category: "model", type: "select", currentValue: session.model,
      options: LISTED.map((entry) => ({ value: entry.modelId, name: entry.name })) },
    { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "act",
      options: [{ value: "act", name: "Act" }, { value: "plan", name: "Plan" }] },
  ];
}
function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    count += 1;
    const sessionId = "s-" + count;
    const session = { provider: "cline-pass", model: LISTED[0].modelId };
    sessions.set(sessionId, session);
    write({ id: message.id, result: { sessionId, configOptions: configOptions(session),
      models: { availableModels: LISTED, currentModelId: session.model } } });
    return;
  }
  if (message.method === "session/set_config_option") {
    const session = sessions.get(params.sessionId);
    log({ event: "set", sessionId: params.sessionId, configId: params.configId, value: params.value });
    // As Cline's acpAgent.ts: a provider must be one it knows, and a model is taken as it is.
    if (params.configId === "provider" && !PROVIDERS.includes(params.value)) {
      write({ id: message.id, error: { code: -32602, message: "Invalid provider " + params.value } });
      return;
    }
    if (params.configId === "provider") session.provider = params.value;
    if (params.configId === "model") session.model = params.value;
    write({ id: message.id, result: { configOptions: configOptions(session) } });
    return;
  }
  if (message.method === "session/prompt") {
    const session = sessions.get(params.sessionId);
    log({ event: "prompt", sessionId: params.sessionId, provider: session.provider, model: session.model });
    write({ method: "session/update", params: { sessionId: params.sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

// The shape of Cline's answer on 2026-10-19, with one id that `isAgentModel` refuses.
const RECOMMENDED = {
  recommended: [{ id: "anthropic/claude-sonnet-5.5", name: "claude-sonnet-5.5", description: "", tags: ["NEW"] }],
  free: [
    { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash", description: "Flash model", tags: [] },
    { id: "cline-free/nemotron-3.5-super-vl", name: "cline-free/nemotron-3.5-super-vl", description: "", tags: [] },
    { id: "~cline-free/not valid", name: "Not valid", description: "", tags: [] },
  ],
  clinePass: [{ id: "cline-pass/glm-5.3", name: "cline-pass/glm-5.3", description: "", tags: [] }],
};

interface LogEntry {
  event: "set" | "prompt";
  sessionId: string;
  configId?: string;
  value?: string;
  provider?: string;
  model?: string;
}

interface Report {
  passed: boolean;
  listed?: { id: string; name: string }[];
  requests?: { headers: Record<string, string>; credentials: string | null }[];
  turns?: { model: string; set: LogEntry[]; sessionProvider: string | null; sessionModel: string | null }[];
  lastGood?: string[];
  bundled?: string[];
  ended?: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-cline-free-models-e2e-"));
const log = join(root, "cline.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_CLINE_LOG = log;

// Cline's endpoint, answered here: `status` 200 with `RECOMMENDED`, or the error status set below.
let status = 200;
let free: { id: string; name: string; description: string; tags: string[] }[] = RECOMMENDED.free;
const requests: NonNullable<Report["requests"]> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    if (String(input) !== CLINE_RECOMMENDED_MODELS_URL) return realFetch(input, init);
    requests.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      credentials: init?.credentials ?? null,
    });
    return status === 200
      ? new Response(JSON.stringify({ ...RECOMMENDED, free }), {
          status,
          headers: { "content-type": "application/json" },
        })
      : new Response("unavailable", { status });
  },
  { preconnect: realFetch.preconnect },
);

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function open(cli: AgentCliInfo): AgentClient {
  const client = requireProviderDriver("cline").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  return client;
}

async function listModels(client: AgentClient): Promise<ModelListResponse["data"]> {
  const response = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  return response.data;
}

/** Starts a turn and waits for its completion. */
async function runTurn(client: AgentClient, thread: string, model: string): Promise<void> {
  // `AgentClient` has no `off`, so a finished turn's listener stays and ignores what follows.
  let finished = false;
  const done = new Promise<void>((finish, fail) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "error") fail(new Error(getString(notification.params, "message") ?? "error"));
      if (notification.method === "turn/completed") {
        finished = true;
        finish();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, model, input: [{ type: "text", text: "hello", text_elements: [] }] },
      (value) => value,
    ),
  );
  await done;
}

try {
  const executable = join(root, "cline", "bin", "cline");
  const workspace = join(root, "workspace");
  await mkdir(join(root, "cline", "bin"), { recursive: true });
  await mkdir(workspace);
  await writeFile(executable, FAKE_CLINE);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "3.0.73", source: "managed" };

  // 1. The picker gets the CLI's models, then Cline's free ones with a "(free)" name.
  const client = open(cli);
  const listed = (await listModels(client)).map((model) => ({ id: model.model ?? "", name: model.displayName ?? "" }));
  assert.deepEqual(
    listed,
    [
      { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
      { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
      { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash (free)" },
      { id: "cline-free/nemotron-3.5-super-vl", name: "cline-free/nemotron-3.5-super-vl (free)" },
    ],
    "The picker lists the CLI's models and Cline's valid free models.",
  );
  assert.ok(requests.length > 0, "OpenBot reads Cline's recommended models.");
  for (const request of requests) {
    assert.deepEqual(request.headers, { accept: "application/json" }, "The request sends no account data.");
    assert.equal(request.credentials, null, "The request sends no credentials.");
  }
  report.listed = listed;
  report.requests = requests;

  // 2. A listed and a free model each reach the session through the `model` option, not `provider`.
  // The session starts on `cline-pass`: a listed model keeps it, and a free one moves it to `cline`.
  await rm(log, { force: true });
  const started = await runCauseEffect(
    client.request("thread/start", { model: "openai/gpt-6-astra", cwd: workspace }, (value) => value),
  );
  const thread = JSON.stringify(started).match(/"id":"([^"]+)"/)?.[1];
  assert.ok(thread, "thread/start answers a thread id.");
  report.turns = [];
  // A listed model after the free one sets the session's own provider back.
  for (const [model, provider, providerChange] of [
    ["openai/gpt-6-astra", "cline-pass", false],
    ["cline-free/minimax-m3.1-flash", "cline", true],
    ["openai/gpt-6-astra", "cline-pass", true],
  ] as const) {
    await rm(log, { force: true });
    await runTurn(client, thread, model);
    const entries: LogEntry[] = (await readLog()).filter((entry) => entry.sessionId === thread);
    const set = entries.filter((entry) => entry.event === "set");
    const prompt = entries.filter((entry) => entry.event === "prompt").at(-1);
    const modelSet = set.findIndex((entry) => entry.configId === "model" && entry.value === model);
    assert.ok(modelSet >= 0, `${model} is sent as the model option.`);
    if (providerChange) {
      const providerSet = set.findIndex((entry) => entry.configId === "provider" && entry.value === provider);
      assert.ok(providerSet >= 0 && providerSet < modelSet, `${model} sets the ${provider} provider first.`);
    } else {
      assert.ok(!set.some((entry) => entry.configId === "provider"), `${model} does not change the provider.`);
    }
    assert.equal(prompt?.provider, provider, `The turn on ${model} uses the ${provider} provider.`);
    assert.equal(prompt?.model, model, `The turn on ${model} runs on it.`);
    report.turns.push({ model, set, sessionProvider: prompt?.provider ?? null, sessionModel: prompt?.model ?? null });
  }

  // 3. A list that cannot be read keeps the last good one.
  status = 503;
  const lastGood = (await listModels(client))
    .map((model) => model.model ?? "")
    .filter((id) => id.startsWith("cline-free/"));
  assert.deepEqual(
    lastGood,
    ["cline-free/minimax-m3.1-flash", "cline-free/nemotron-3.5-super-vl"],
    "A failed read keeps the free models of the last good one.",
  );
  report.lastGood = lastGood;

  // 4. With no good read yet, the bundled free tier is listed.
  const bundled = (await listModels(open(cli)))
    .map((model) => model.model ?? "")
    .filter((id) => id.startsWith("cline-free/"));
  assert.deepEqual(
    bundled,
    [
      "cline-free/minimax-m3.1-flash",
      "cline-free/nemotron-3.5-super-vl",
      "cline-free/mimo-v2.6-flash",
      "cline-free/muse-spark-1.3-contributor",
      "cline-free/solar-mini4",
    ],
    "With no good read, the bundled free tier is listed.",
  );
  report.bundled = bundled;

  // 5. An empty free tier is an answer: the picker does not keep the old free models.
  status = 200;
  free = [];
  const ended = (await listModels(client)).map((model) => model.model ?? "");
  assert.deepEqual(
    ended,
    ["anthropic/claude-sonnet-5.5", "openai/gpt-6-astra"],
    "An empty free tier removes the free models.",
  );
  report.ended = ended;
  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
