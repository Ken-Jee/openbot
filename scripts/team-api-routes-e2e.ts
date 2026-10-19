// Drives the real `TeamApiServer` on a loopback port over HTTP, as a remote client does. The team
// store and the direct-message store are the real ones on temporary files. The agent service, the
// mailbox and the browser are small in-memory stand-ins that record each call, so a check can show
// that a refused request did not reach them. The checks cover the protocol and auth gates, sign-in
// and account tickets, the admin-only routes, direct-message isolation, agents hidden from an older
// protocol, the queue routes, the attachment and file routes with their size limits, and the error
// codes. Writes .openbot-build/team-api-routes-e2e/report.json.
// Run: `bun run test:team-api-routes` (the preload gives the server's import graph an `electron`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentProviderId,
  AgentSummary,
  AttachmentDataInput,
  CentralAuthUser,
  HiddenAgentsSnapshot,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { QueueEditRejectedError, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { SteerUnsupportedError } from "../src/backend/agent/queue-controls";
import { AgentLifecycleFailed } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { TeamChatStore } from "../src/backend/team-chat-store";
import type { TeamApiAgents, TeamApiBrowser, TeamApiMailbox } from "../src/main/team-api/dependencies";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/team-api-routes-e2e");
const APP_VERSION = "0.43.0";
const MIB = 1024 * 1024;

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

/** A parsed JSON response body. `JSON.parse` gives only these values. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Reply {
  status: number;
  body: Json;
  text: string;
  headers: Headers;
}

interface ReplySummary {
  status: number;
  body: Json;
}

interface CallOptions {
  token?: string;
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  protocol?: number | null;
  capabilities?: string[];
  headers?: Record<string, string>;
}

interface RecordedCall {
  method: string;
  args: readonly unknown[];
}

mkdirSync(OUT, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "openbot-team-api-routes-"));
const checks: Check[] = [];
const calls: RecordedCall[] = [];
const logged: string[] = [];
// The uploads that reached `prepareImportedAttachments`, with their bytes.
const uploads: AttachmentDataInput[] = [];
let clock = Date.now();

function check(name: string, passed: boolean, detail: unknown = null): void {
  checks.push({ name, passed, detail });
}

function record(method: string, ...args: unknown[]): void {
  calls.push({ method, args });
}

function callsOf(method: string): readonly (readonly unknown[])[] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

function parseJson(text: string): Json {
  const value: Json = JSON.parse(text);
  return value;
}

function objectKeys(value: Json | undefined): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

function field(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let current = value;
  for (const key of path) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) current = typeof key === "number" ? current[key] : undefined;
    else current = typeof key === "string" ? current[key] : undefined;
  }
  return current;
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the Team API routes E2E run.`);
  };
}

// The fake secret is put together at run time so that a secret scanner does not read it as a real key.
const FAKE_SECRET = ["sk", "ant", "e2e", "fake0000000000000000"].join("-");

// Files that the fake mailbox and the fake file resolvers point at.
const files = join(root, "files");
mkdirSync(files, { recursive: true });
const attachmentPath = join(files, "report one.txt");
const attachmentBytes = "attachment bytes for the download check\n";
writeFileSync(attachmentPath, attachmentBytes);
const sharedPath = join(files, "shared.txt");
writeFileSync(sharedPath, "shared file bytes\n");
const workspacePath = join(files, "notes.md");
writeFileSync(workspacePath, "# workspace notes\n");

function agent(id: string, name: string, provider: AgentProviderId, model: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: true,
    provider,
    model,
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "workspaces", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

// `agent-oc` uses OpenCode, which protocol 3 does not know; `agent-pi` uses Pi, which protocols
// below 7 do not know. The server hides each one from a client on such a protocol.
const agents = [
  agent("agent-ada", "Ada", "claude", "claude-sonnet-4-5"),
  agent("agent-oc", "Oscar", "opencode", "anthropic/claude-sonnet-4-5"),
  agent("agent-pi", "Pia", "pi", "anthropic/claude-sonnet-4-5"),
];

function queueSnapshot(agentId: string): QueueSnapshot {
  return {
    agentId,
    deliveries: [
      {
        id: "delivery-1",
        messageId: "message-1",
        recipientAgentId: agentId,
        sender: { kind: "user" },
        text: "queued text",
        attachments: [],
        replyToMessageId: null,
        status: "queued",
        position: 1,
        turnId: null,
        error: null,
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

let hidden: HiddenAgentsSnapshot = { agents: [{ agentId: "agent-pi", hiddenAt: new Date(0).toISOString() }] };

const fakeAgents: TeamApiAgents = {
  on: () => undefined,
  off: () => undefined,
  preferredProvider: () => "claude",
  newAgentProvider: () => "claude",
  getStatus: () => {
    throw new Error(`The status backend failed with ${FAKE_SECRET}.`);
  },
  listAgents: () => agents,
  listQueue: (agentId) => {
    record("listQueue", agentId);
    return queueSnapshot(agentId);
  },
  acknowledgeFailedTurn: (agentId, turnId) => record("acknowledgeFailedTurn", agentId, turnId),
  cancelQueuedMessage: (agentId, deliveryId) => Effect.sync(() => record("cancelQueuedMessage", agentId, deliveryId)),
  steerQueuedMessage: (input) => {
    record("steerQueuedMessage", input);
    // OpenCode defers steering: the queue keeps the message and refuses the steer.
    if (input.agentId === "agent-oc")
      return Effect.fail(
        new AgentLifecycleFailed({ operation: "steerQueuedMessage", cause: new SteerUnsupportedError() }),
      );
    return Effect.void;
  },
  updateQueuedMessage: (input, sender) => Effect.sync(() => record("updateQueuedMessage", input, sender)),
  editQueuedMessage: (agentId, input, sender) => {
    record("editQueuedMessage", agentId, input, sender);
    if (input.editId === "edit-rejected") {
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "editQueuedMessage",
          cause: new QueueEditRejectedError("another editor holds this message."),
        }),
      );
    }
    return Effect.succeed(queueSnapshot(agentId));
  },
  reorderQueue: (input) => Effect.sync(() => record("reorderQueue", input)),
  interrupt: (agentId, turnId) => Effect.sync(() => record("interrupt", agentId, turnId)),
  prepareImportedAttachments: (paths, data) =>
    Effect.sync(() => {
      record("prepareImportedAttachments", paths, data);
      uploads.push(...data);
      return data.map((item, index) => ({
        id: `draft-${index + 1}`,
        name: item.name,
        size: item.bytes.length,
        kind: "file",
        mimeType: item.mimeType,
        previewKind: "none",
        previewUrl: null,
      }));
    }),
  discardDraftAttachment: (id) => Effect.sync(() => record("discardDraftAttachment", id)),
  resolveSharedFile: (path) =>
    Effect.sync(() => {
      record("resolveSharedFile", path);
      return path === "big.bin"
        ? { path: sharedPath, name: "big.bin", size: ATTACHMENT_LIMITS.fileBytes + 1 }
        : { path: sharedPath, name: "shared.txt", size: readFileSync(sharedPath).length };
    }),
  resolveWorkspaceFile: (agentId, path) =>
    Effect.sync(() => {
      record("resolveWorkspaceFile", agentId, path);
      return path === "big.bin"
        ? { path: workspacePath, name: "big.bin", size: ATTACHMENT_LIMITS.fileBytes + 1, insideWorkspace: true }
        : { path: workspacePath, name: "notes.md", size: readFileSync(workspacePath).length, insideWorkspace: true };
    }),
  deleteAgent: (agentId) => Effect.sync(() => record("deleteAgent", agentId)),
  getRuntimeSnapshot: unused("getRuntimeSnapshot"),
  getUsage: unused("getUsage"),
  getAnalytics: unused("getAnalytics"),
  getHostAnalytics: unused("getHostAnalytics"),
  listModels: unused("listModels"),
  sidebarChatIds: unused("sidebarChatIds"),
  listConversationReads: unused("listConversationReads"),
  generateProfile: unused("generateProfile"),
  saveProfile: unused("saveProfile"),
  createAgent: unused("createAgent"),
  committedAgentDuplication: unused("committedAgentDuplication"),
  duplicateAgent: unused("duplicateAgent"),
  commitAgentDuplication: unused("commitAgentDuplication"),
  updateAgent: unused("updateAgent"),
  getMemorySelection: unused("getMemorySelection"),
  setMemoryInclusion: unused("setMemoryInclusion"),
  listMemories: unused("listMemories"),
  createMemory: unused("createMemory"),
  updateMemory: unused("updateMemory"),
  deleteMemory: unused("deleteMemory"),
  clearMemories: unused("clearMemories"),
  listRoutines: unused("listRoutines"),
  createRoutine: unused("createRoutine"),
  updateRoutine: unused("updateRoutine"),
  deleteRoutine: unused("deleteRoutine"),
  testRoutine: unused("testRoutine"),
  listRoutineRuns: unused("listRoutineRuns"),
  listChannelMemories: unused("listChannelMemories"),
  createChannelMemory: unused("createChannelMemory"),
  updateChannelMemory: unused("updateChannelMemory"),
  deleteChannelMemory: unused("deleteChannelMemory"),
  clearChannelMemories: unused("clearChannelMemories"),
  listChannelRoutines: unused("listChannelRoutines"),
  createChannelRoutine: unused("createChannelRoutine"),
  updateChannelRoutine: unused("updateChannelRoutine"),
  deleteChannelRoutine: unused("deleteChannelRoutine"),
  testChannelRoutine: unused("testChannelRoutine"),
  listChannelRoutineRuns: unused("listChannelRoutineRuns"),
  setAvatar: unused("setAvatar"),
  resolveAvatar: unused("resolveAvatar"),
  readConversation: unused("readConversation"),
  readConversationFor: unused("readConversationFor"),
  readConversationPageFor: unused("readConversationPageFor"),
  searchConversationMessages: unused("searchConversationMessages"),
  searchConversationFiles: unused("searchConversationFiles"),
  markConversationRead: unused("markConversationRead"),
  markConversationUnread: unused("markConversationUnread"),
  listWorkspaceDirectory: unused("listWorkspaceDirectory"),
  sendMessage: unused("sendMessage"),
  setMessageReaction: unused("setMessageReaction"),
  clearAgentContext: unused("clearAgentContext"),
  respondToPrompt: unused("respondToPrompt"),
  respondToApproval: unused("respondToApproval"),
  respondToBrowserSecret: unused("respondToBrowserSecret"),
  respondToBrowserTakeover: unused("respondToBrowserTakeover"),
};

const mailbox: TeamApiMailbox = {
  resolveAttachment: (id) =>
    Effect.succeed(id === "att-1" ? { path: attachmentPath, mimeType: "text/plain", name: "report one.txt" } : null),
};

// The holders whose browser control a route gave back, so a session end can be checked.
const releasedHolders: Parameters<TeamApiBrowser["releaseUserControlHeldBy"]>[0][] = [];
const releasedSession = (sessionId: string | undefined) =>
  releasedHolders.some((holder) => holder.kind === "session" && holder.sessionId === sessionId);

const browser: TeamApiBrowser = {
  listTabs: unused("listTabs"),
  getControlState: unused("getControlState"),
  open: unused("open"),
  activate: unused("activate"),
  navigate: unused("navigate"),
  reload: unused("reload"),
  stop: unused("stop"),
  takeUserControl: unused("takeUserControl"),
  releaseUserControl: unused("releaseUserControl"),
  releaseUserControlHeldBy: (holder) => {
    releasedHolders.push(holder);
  },
  close: unused("close"),
  capturePreview: unused("capturePreview"),
  setVisible: unused("setVisible"),
  getDisplayState: unused("getDisplayState"),
  loadUrl: unused("loadUrl"),
  isPrivate: unused("isPrivate"),
  startView: unused("startView"),
  dispatchViewInput: unused("dispatchViewInput"),
  copyViewSelection: unused("copyViewSelection"),
};

// Account tickets that the fake account service redeems. Anything else is a ticket it refuses.
const accountUsers: Record<string, CentralAuthUser> = {
  "ticket-bob": { id: "account-bob", email: "bob@example.com", name: "Bob", avatarUrl: null },
  "ticket-stranger": { id: "account-stranger", email: "stranger@example.com", name: null, avatarUrl: null },
};
const redeemedServerIds: string[] = [];

const store = new TeamStore(join(root, "team.json"));
const database = new OpenBotDatabase(join(root, "user-data"));
let server: TeamApiServer | null = null;

try {
  await runCauseEffect(store.initialize());
  const OWNER_PASSWORD = "owner-password-e2e";
  await runCauseEffect(store.configure("E2E Server", "owner", OWNER_PASSWORD));
  await runCauseEffect(database.initialize());
  const owner = await runCauseEffect(store.login("owner", OWNER_PASSWORD));
  const serverId = store.getIdentity()?.serverId;
  assert.ok(serverId, "The team store has no identity after configure.");

  server = new TeamApiServer({
    appVersion: APP_VERSION,
    store,
    agents: fakeAgents,
    mailbox,
    browser,
    chat: new TeamChatStore(database),
    hiddenAgents: {
      listHiddenAgents: () => hidden,
      setAgentHidden: (input) =>
        Effect.sync(() => {
          record("setAgentHidden", input);
          const others = hidden.agents.filter((entry) => entry.agentId !== input.agentId);
          hidden = {
            agents: input.hidden
              ? [...others, { agentId: input.agentId, hiddenAt: new Date(clock).toISOString() }]
              : others,
          };
          return hidden;
        }),
    },
    redeemCentralTicket: (ticket, id) =>
      Effect.sync(() => {
        redeemedServerIds.push(id);
        return accountUsers[ticket] ?? null;
      }),
    now: () => clock,
    logger: createOpenBotLogger("team-api-e2e", (line) => logged.push(line)),
  });
  const port = await Effect.runPromise(server.start());
  const base = `http://127.0.0.1:${port}`;

  function protocolHeaders(options: CallOptions): Record<string, string> {
    const protocol = options.protocol === undefined ? 7 : options.protocol;
    return {
      ...(protocol === null
        ? {}
        : {
            [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
            [TEAM_APP_VERSION_HEADER]: APP_VERSION,
            [TEAM_CAPABILITIES_HEADER]: (
              options.capabilities ?? [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY]
            ).join(","),
          }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    };
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<Reply> {
    const headers = protocolHeaders(options);
    let body: string | Uint8Array<ArrayBuffer> | null = null;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.bytes) body = options.bytes;
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: Json = null;
    if (response.headers.get("content-type")?.startsWith("application/json")) parsed = parseJson(text);
    return { status: response.status, body: parsed, text, headers: response.headers };
  }

  /** One raw request with a declared length, for the body limits that `fetch` cannot reach. */
  function rawCall(path: string, token: string, contentLength: number, body: Uint8Array | null): Promise<ReplySummary> {
    return new Promise((resolveCall, rejectCall) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: {
            ...protocolHeaders({ token }),
            "Content-Type": "application/octet-stream",
            "Content-Length": String(contentLength),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            request.destroy();
            const text = Buffer.concat(chunks).toString("utf8");
            resolveCall({ status: response.statusCode ?? 0, body: text ? parseJson(text) : null });
          });
        },
      );
      request.on("error", rejectCall);
      if (body) request.end(body);
      else request.flushHeaders();
    });
  }

  function errorIs(reply: Reply, status: number, message: string): boolean {
    return reply.status === status && field(reply.body, "error") === message;
  }

  function summary(reply: Reply): ReplySummary {
    return { status: reply.status, body: reply.body ?? reply.text.slice(0, 200) };
  }

  // ---- Protocol gate ----
  {
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: null });
    check(
      "compatibility answers without protocol headers and names the supported range",
      compatibility.status === 200 &&
        field(compatibility.body, "protocol", "minimum") === 1 &&
        field(compatibility.body, "protocol", "maximum") === 7,
      summary(compatibility),
    );
    const noHeaders = await call("GET", TEAM_API_ROUTES.identity, { protocol: null });
    check(
      "a request without protocol headers gets 426 client_update_required",
      noHeaders.status === 426 && field(noHeaders.body, "code") === "client_update_required",
      summary(noHeaders),
    );
    const badHeader = await call("GET", TEAM_API_ROUTES.identity, {
      headers: { [TEAM_PROTOCOL_VERSION_HEADER]: "7.5" },
    });
    check(
      "a protocol header that is not an integer gets 400 protocol_error",
      badHeader.status === 400 && field(badHeader.body, "code") === "protocol_error",
      summary(badHeader),
    );
    const newer = await call("GET", TEAM_API_ROUTES.identity, { protocol: 8 });
    check(
      "a newer protocol gets 426 host_update_required with the client version",
      newer.status === 426 &&
        field(newer.body, "code") === "host_update_required" &&
        field(newer.body, "client", "protocol") === 8,
      summary(newer),
    );
    const zero = await call("GET", TEAM_API_ROUTES.identity, { protocol: 0 });
    check(
      "protocol 0 is not a valid protocol header and gets 400 protocol_error",
      zero.status === 400 && field(zero.body, "code") === "protocol_error",
      summary(zero),
    );
    const identity = await call("GET", TEAM_API_ROUTES.identity);
    check(
      "identity answers without a token and names this server",
      identity.status === 200 && field(identity.body, "serverId") === serverId,
      summary(identity),
    );
  }

  // ---- Join with an invitation and with an account ticket ----
  const adminInvite = await runCauseEffect(store.createInvite("admin"));
  const memberInvite = await runCauseEffect(store.createInvite("member"));
  const ADA_PASSWORD = "ada-password-e2e-1";
  const adaJoin = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: adminInvite.token, username: "ada", password: ADA_PASSWORD },
  });
  const adaToken = field(adaJoin.body, "sessionToken");
  const adaId = field(adaJoin.body, "member", "id");
  check(
    "join with an admin invitation gives 201 and an admin session",
    adaJoin.status === 201 && typeof adaToken === "string" && field(adaJoin.body, "member", "role") === "admin",
    { status: adaJoin.status, role: field(adaJoin.body, "member", "role") },
  );
  assert.ok(typeof adaToken === "string" && typeof adaId === "string", "ada did not join.");

  const reuse = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: adminInvite.token, username: "ada2", password: ADA_PASSWORD },
  });
  check(
    "a used invitation is refused with inviteInvalid",
    errorIs(reuse, 400, sourceText("error.team.inviteInvalid")),
    summary(reuse),
  );

  const unknownTicket = await call("POST", TEAM_API_ROUTES.join.account, {
    json: { inviteToken: memberInvite.token, accountTicket: "ticket-unknown" },
  });
  check(
    "join with a ticket that the account service refuses gives 401 signInRequired",
    errorIs(unknownTicket, 401, sourceText("error.team.signInRequired")),
    summary(unknownTicket),
  );
  const bobJoin = await call("POST", TEAM_API_ROUTES.join.account, {
    json: { inviteToken: memberInvite.token, accountTicket: "ticket-bob" },
  });
  const bobToken = field(bobJoin.body, "sessionToken");
  const bobId = field(bobJoin.body, "member", "id");
  check(
    "join with an account ticket gives 201 and a member with the account email",
    bobJoin.status === 201 &&
      field(bobJoin.body, "member", "role") === "member" &&
      field(bobJoin.body, "member", "email") === "bob@example.com",
    { status: bobJoin.status, role: field(bobJoin.body, "member", "role") },
  );
  check(
    "the ticket is redeemed for this server only",
    redeemedServerIds.length > 0 && redeemedServerIds.every((id) => id === serverId),
    { redeemedServerIds, serverId },
  );
  assert.ok(typeof bobToken === "string" && typeof bobId === "string", "bob did not join.");

  const seatInvite = await runCauseEffect(store.createInvite("member"));
  const fourth = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: seatInvite.token, username: "carol", password: "carol-password-e2e" },
  });
  check(
    "a fourth member is refused with memberLimit",
    errorIs(fourth, 400, sourceText("error.team.memberLimit", { limit: 3 })) && store.listMembers().length === 3,
    summary(fourth),
  );

  // ---- Sign-in, rate limit, account sign-in, logout ----
  {
    const results: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await call("POST", TEAM_API_ROUTES.auth.login, {
        json: { username: "owner", password: "not-the-owner-password" },
      });
      results.push(wrong.status);
    }
    const blocked = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "owner", password: OWNER_PASSWORD },
    });
    check(
      "five wrong passwords give loginIncorrect, then the correct password gets 429",
      results.every((status) => status === 400) &&
        errorIs(blocked, 429, sourceText("error.team.tooManySignInAttempts")) &&
        field(blocked.body, "sessionToken") === undefined,
      { results, blocked: summary(blocked) },
    );
    const otherUser = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "ada", password: ADA_PASSWORD },
    });
    check(
      "the limit of one user name does not block another user name",
      otherUser.status === 200 && typeof field(otherUser.body, "sessionToken") === "string",
      { status: otherUser.status },
    );
    clock += 15 * 60 * 1_000 + 1;
    const afterWindow = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "owner", password: OWNER_PASSWORD },
    });
    check(
      "after the 15 minute window the owner signs in again",
      afterWindow.status === 200 && field(afterWindow.body, "member", "role") === "owner",
      { status: afterWindow.status },
    );

    const adaSecond = field(otherUser.body, "sessionToken");
    assert.ok(typeof adaSecond === "string", "ada has no second session.");
    const adaSecondSession = store.authenticateSession(adaSecond)?.sessionId;
    const logout = await call("POST", TEAM_API_ROUTES.auth.logout, { token: adaSecond, json: {} });
    const afterLogout = await call("GET", TEAM_API_ROUTES.me, { token: adaSecond });
    const firstStill = await call("GET", TEAM_API_ROUTES.me, { token: adaToken });
    check(
      "logout ends only that session and gives back the browser control of that session",
      logout.status === 204 &&
        errorIs(afterLogout, 401, sourceText("error.team.authenticationRequired")) &&
        firstStill.status === 200 &&
        releasedSession(adaSecondSession),
      {
        logout: logout.status,
        afterLogout: afterLogout.status,
        firstStill: firstStill.status,
        released: releasedSession(adaSecondSession),
      },
    );
  }

  const bobSessionsBefore = new Set(store.listSessions().map((session) => session.id));
  const accountLogin = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-bob" } });
  const bobSecond = field(accountLogin.body, "sessionToken");
  check(
    "account sign-in with a member ticket gives a session for that member",
    accountLogin.status === 200 && field(accountLogin.body, "member", "id") === bobId && typeof bobSecond === "string",
    { status: accountLogin.status },
  );
  assert.ok(typeof bobSecond === "string", "bob has no account session.");
  const bobSecondSession = store
    .listSessions()
    .find((session) => !bobSessionsBefore.has(session.id) && session.memberId === bobId);
  const stranger = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-stranger" } });
  check(
    "account sign-in for an account that is not a member gives accountNotMember",
    errorIs(stranger, 400, sourceText("error.team.accountNotMember")) &&
      field(stranger.body, "sessionToken") === undefined,
    summary(stranger),
  );
  const refusedTicket = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-unknown" } });
  check(
    "account sign-in with a refused ticket gives 401 signInRequired",
    errorIs(refusedTicket, 401, sourceText("error.team.signInRequired")),
    summary(refusedTicket),
  );

  // ---- Auth gate ----
  {
    const required = sourceText("error.team.authenticationRequired");
    const noToken = await call("GET", TEAM_API_ROUTES.me);
    const unknownPath = await call("GET", "/v1/no-such-route");
    const shortToken = await call("GET", TEAM_API_ROUTES.me, { headers: { Authorization: "Bearer short" } });
    const unknownToken = await call("GET", TEAM_API_ROUTES.me, { token: "A".repeat(43) });
    const basic = await call("GET", TEAM_API_ROUTES.me, { headers: { Authorization: `Basic ${bobToken}` } });
    check(
      "no token, a malformed token, an unknown token and a non-bearer scheme all get 401",
      [noToken, shortToken, unknownToken, basic].every((reply) => errorIs(reply, 401, required)),
      [noToken, shortToken, unknownToken, basic].map((reply) => reply.status),
    );
    check(
      "an unknown route without a token gets 401, not 404",
      errorIs(unknownPath, 401, required),
      summary(unknownPath),
    );
    const me = await call("GET", TEAM_API_ROUTES.me, { token: bobToken });
    check(
      "me returns the caller and no credential fields",
      me.status === 200 &&
        field(me.body, "id") === bobId &&
        field(me.body, "role") === "member" &&
        !/password|salt|hash|token/iu.test(objectKeys(me.body).join(",")),
      summary(me),
    );
    const notFound = await call("GET", "/v1/no-such-route", { token: bobToken });
    const wrongMethod = await call("PUT", TEAM_API_ROUTES.me, { token: bobToken, json: {} });
    check(
      "an unknown route and a wrong method with a token get 404 routeNotFound",
      errorIs(notFound, 404, sourceText("error.team.routeNotFound")) &&
        errorIs(wrongMethod, 404, sourceText("error.team.routeNotFound")),
      { notFound: notFound.status, wrongMethod: wrongMethod.status },
    );
    const events = await call("GET", TEAM_API_ROUTES.events, { token: bobToken });
    const remoteMac = await call("GET", TEAM_API_ROUTES.host.remoteMac, { token: bobToken });
    const remoteDesktop = await call("GET", TEAM_API_ROUTES.host.remoteDesktopAccess, { token: bobToken });
    check(
      "events over HTTP and the two removed host routes get 426",
      events.status === 426 &&
        [remoteMac, remoteDesktop].every(
          (reply) =>
            errorIs(reply, 426, sourceText("error.team.updateRequired")) &&
            field(reply.body, "code") === "protocol_mismatch",
        ),
      [summary(events), summary(remoteMac), summary(remoteDesktop)],
    );
  }

  // ---- Admin-only routes: a member is refused and nothing changes ----
  {
    const adminRequired = sourceText("error.team.adminRequired");
    const membersBefore = JSON.stringify(store.listMembers());
    const invitesBefore = store.listInvites().length;
    const sessionsBefore = store.listSessions().length;
    const ownerSession = store.authenticateSession(owner.sessionToken)?.sessionId ?? "";
    const memberAttempts = [
      await call("GET", TEAM_API_ROUTES.team.members, { token: bobToken }),
      await call("PATCH", TEAM_API_ROUTES.team.member(adaId), { token: bobToken, json: { disabled: true } }),
      await call("DELETE", TEAM_API_ROUTES.team.member(adaId), { token: bobToken }),
      await call("POST", TEAM_API_ROUTES.team.invites, { token: bobToken, json: { role: "admin" } }),
      await call("GET", TEAM_API_ROUTES.team.invites, { token: bobToken }),
      await call("DELETE", TEAM_API_ROUTES.team.invite(seatInvite.id), { token: bobToken }),
      await call("GET", TEAM_API_ROUTES.team.sessions, { token: bobToken }),
      await call("DELETE", TEAM_API_ROUTES.team.session(ownerSession), { token: bobToken }),
    ];
    check(
      "a member gets 403 adminRequired on every member, invitation and session admin route",
      memberAttempts.every((reply) => errorIs(reply, 403, adminRequired)),
      memberAttempts.map((reply) => reply.status),
    );
    check(
      "the refused admin requests changed no member, invitation or session",
      JSON.stringify(store.listMembers()) === membersBefore &&
        store.listInvites().length === invitesBefore &&
        store.listSessions().length === sessionsBefore,
      {
        members: store.listMembers().length,
        invites: store.listInvites().length,
        sessions: store.listSessions().length,
      },
    );
    const sessionsList = await call("GET", TEAM_API_ROUTES.team.sessions, { token: bobToken });
    check(
      "the refused session list does not include any session data",
      !sessionsList.text.includes(ownerSession) && !sessionsList.text.includes(String(bobId)),
      summary(sessionsList),
    );

    const members = await call("GET", TEAM_API_ROUTES.team.members, { token: adaToken });
    check("an admin lists the three members", members.status === 200 && list(members.body).length === 3, {
      status: members.status,
      count: list(members.body).length,
    });
    const invite = await call("POST", TEAM_API_ROUTES.team.invites, { token: adaToken, json: { role: "member" } });
    check(
      "an invitation without the invite service gets 503 inviteServiceUnavailable",
      errorIs(invite, 503, sourceText("error.team.inviteServiceUnavailable")),
      summary(invite),
    );
    const ownerId = store.getOwnerMemberId() ?? "";
    const changeOwner = await call("PATCH", TEAM_API_ROUTES.team.member(ownerId), {
      token: adaToken,
      json: { role: "member" },
    });
    const badRole = await call("PATCH", TEAM_API_ROUTES.team.member(bobId), {
      token: adaToken,
      json: { role: "owner" },
    });
    const badDisabled = await call("PATCH", TEAM_API_ROUTES.team.member(bobId), {
      token: adaToken,
      json: { disabled: "yes" },
    });
    check(
      "an admin cannot change the owner and gets 400 for an invalid role or disabled value",
      errorIs(changeOwner, 400, sourceText("error.team.ownerCannotChange")) &&
        badRole.status === 400 &&
        badDisabled.status === 400 &&
        store.getMember(ownerId)?.role === "owner" &&
        store.getMember(bobId)?.role === "member",
      [summary(changeOwner), summary(badRole), summary(badDisabled)],
    );
    const revokeOwner = await call("DELETE", TEAM_API_ROUTES.team.session(ownerSession), { token: adaToken });
    check(
      "an admin cannot end a session of the owner",
      errorIs(revokeOwner, 400, sourceText("error.team.ownerCannotChange")) &&
        store.authenticateSession(owner.sessionToken) !== null,
      summary(revokeOwner),
    );
    const revokeBob = await call("DELETE", TEAM_API_ROUTES.team.session(bobSecondSession?.id ?? "missing"), {
      token: adaToken,
    });
    const revokedUse = await call("GET", TEAM_API_ROUTES.me, { token: bobSecond });
    const bobFirst = await call("GET", TEAM_API_ROUTES.me, { token: bobToken });
    check(
      "an admin ends one session of a member; that token gets 401, the other session stays, and the browser control of that session is given back",
      revokeBob.status === 204 &&
        revokedUse.status === 401 &&
        bobFirst.status === 200 &&
        releasedSession(bobSecondSession?.id),
      {
        revoke: revokeBob.status,
        revokedUse: revokedUse.status,
        bobFirst: bobFirst.status,
        released: releasedSession(bobSecondSession?.id),
      },
    );
  }

  // ---- Direct messages stay between the two members ----
  {
    const ownerId = store.getOwnerMemberId() ?? "";
    const privateText = "owner to ada: private plan";
    const sent = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: owner.sessionToken,
      json: { memberId: adaId, text: privateText, clientMessageId: "client-message-1" },
    });
    const adaView = await call("GET", TEAM_API_ROUTES.direct.conversation(ownerId), { token: adaToken });
    check(
      "a direct message reaches its recipient",
      sent.status === 201 &&
        adaView.status === 200 &&
        list(field(adaView.body, "messages")).some((message) => field(message, "text") === privateText),
      { sent: sent.status, adaView: adaView.status },
    );
    const bobThreads = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    const bobWithOwner = await call("GET", TEAM_API_ROUTES.direct.conversation(ownerId), { token: bobToken });
    const bobWithAda = await call("GET", TEAM_API_ROUTES.direct.conversation(adaId), { token: bobToken });
    const bobPage = await call("GET", TEAM_API_ROUTES.direct.conversationPage(ownerId), { token: bobToken });
    check(
      "a third member does not see the direct message in threads, conversations or pages",
      [bobThreads, bobWithOwner, bobWithAda, bobPage].every(
        (reply) => reply.status === 200 && !reply.text.includes(privateText),
      ) && list(bobThreads.body).length === 0,
      [bobThreads, bobWithOwner, bobWithAda, bobPage].map((reply) => reply.status),
    );
    const loggedBefore = logged.length;
    const toSelf = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: bobId, text: "hello me", clientMessageId: "client-message-2" },
    });
    const toStranger = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: "not-a-member", text: "hello stranger", clientMessageId: "client-message-3" },
    });
    const withStranger = await call("GET", TEAM_API_ROUTES.direct.conversation("not-a-member"), { token: bobToken });
    const threadsAfter = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    const unavailable = sourceText("error.team.directRecipientUnavailable");
    check(
      "a direct message to oneself gets 400; to someone not on the team, 404; nothing is stored",
      errorIs(toSelf, 400, sourceText("error.team.directMessageSelf")) &&
        errorIs(toStranger, 404, unavailable) &&
        errorIs(withStranger, 404, unavailable) &&
        threadsAfter.status === 200 &&
        list(threadsAfter.body).length === 0,
      {
        toSelf: summary(toSelf),
        toStranger: summary(toStranger),
        withStranger: summary(withStranger),
        threadsAfter: summary(threadsAfter),
      },
    );
    check(
      "the refused direct messages are client errors and write no error log line",
      logged.slice(loggedBefore).every((line) => !line.includes("Team API request failed")),
      { lines: logged.slice(loggedBefore) },
    );
  }

  // ---- Agents hidden from an older protocol ----
  {
    const notFound = sourceText("error.team.agentNotFound");
    const ids = (reply: Reply) => list(reply.body).map((item) => field(item, "id"));
    const v3 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken, protocol: 3 });
    const v6 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken, protocol: 6 });
    const v7 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken });
    check(
      "the agent list leaves out the agents whose provider the client protocol does not know",
      isDeepStrictEqual(ids(v3), ["agent-ada"]) &&
        isDeepStrictEqual(ids(v6), ["agent-ada", "agent-oc"]) &&
        isDeepStrictEqual(ids(v7), ["agent-ada", "agent-oc", "agent-pi"]),
      { v3: ids(v3), v6: ids(v6), v7: ids(v7) },
    );
    const listQueueCalls = callsOf("listQueue").length;
    const pathV3 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-oc"), { token: bobToken, protocol: 3 });
    const pathV6 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-pi"), { token: bobToken, protocol: 6 });
    const queryV6 = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-pi&path=notes.md`, {
      token: bobToken,
      protocol: 6,
    });
    check(
      "a hidden agent in the path or in the botId query gets 404 agentNotFound and reaches no service",
      [pathV3, pathV6, queryV6].every((reply) => errorIs(reply, 404, notFound)) &&
        callsOf("listQueue").length === listQueueCalls &&
        callsOf("resolveWorkspaceFile").length === 0,
      [summary(pathV3), summary(pathV6), summary(queryV6)],
    );
    const pathV7 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-pi"), { token: bobToken });
    check("the same agent is reachable on protocol 7", pathV7.status === 200, summary(pathV7));

    const readHidden = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {} });
    const readHiddenV6 = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {}, protocol: 6 });
    check(
      "a member reads the hidden agents, without the agents that the client protocol does not know",
      readHidden.status === 200 &&
        isDeepStrictEqual(
          list(field(readHidden.body, "agents")).map((item) => field(item, "agentId")),
          ["agent-pi"],
        ) &&
        readHiddenV6.status === 200 &&
        list(field(readHiddenV6.body, "agents")).length === 0,
      [summary(readHidden), summary(readHiddenV6)],
    );
    const unsupported = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {}, capabilities: [] });
    check(
      "the hidden-agent routes without the capability get 400 agentHideUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentHideUnsupported")),
      summary(unsupported),
    );
    const memberSet = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", hidden: true },
    });
    check(
      "a member cannot hide an agent",
      errorIs(memberSet, 403, sourceText("error.team.membersCannotHideAgents")) &&
        callsOf("setAgentHidden").length === 0,
      summary(memberSet),
    );
    const adminSetHidden = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", hidden: false },
      protocol: 6,
    });
    check(
      "an admin cannot change an agent that the client protocol does not show",
      errorIs(adminSetHidden, 404, notFound) && callsOf("setAgentHidden").length === 0,
      summary(adminSetHidden),
    );
    const adminSet = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", hidden: true },
    });
    check(
      "an admin hides an agent and gets the new list",
      adminSet.status === 200 &&
        list(field(adminSet.body, "agents")).some((item) => field(item, "agentId") === "agent-ada") &&
        isDeepStrictEqual(callsOf("setAgentHidden").at(-1), [{ agentId: "agent-ada", hidden: true }]),
      summary(adminSet),
    );

    const memberDelete = await call("DELETE", TEAM_API_ROUTES.agent.one("agent-ada"), { token: bobToken });
    check(
      "a member cannot delete an agent",
      errorIs(memberDelete, 403, sourceText("error.team.membersCannotDeleteAgents")) &&
        callsOf("deleteAgent").length === 0,
      summary(memberDelete),
    );
  }

  // ---- Queue routes ----
  {
    const bobSender = { id: bobId, name: "Bob" };
    const queue = await call("GET", TEAM_API_ROUTES.agent.queue("agent-ada"), { token: bobToken });
    check(
      "the queue route returns the queue of the agent in the path",
      queue.status === 200 &&
        field(queue.body, "botId") === "agent-ada" &&
        field(queue.body, "deliveries", 0, "id") === "delivery-1" &&
        isDeepStrictEqual(callsOf("listQueue").at(-1), ["agent-ada"]),
      summary(queue),
    );
    const acknowledge = await call("POST", TEAM_API_ROUTES.agent.failuresAcknowledge("agent-ada"), {
      token: bobToken,
      json: { turnId: "turn-1" },
    });
    const acknowledgeEmpty = await call("POST", TEAM_API_ROUTES.agent.failuresAcknowledge("agent-ada"), {
      token: bobToken,
      json: {},
    });
    check(
      "acknowledging a failed turn gives 204, and a missing turnId gives 400",
      acknowledge.status === 204 &&
        isDeepStrictEqual(callsOf("acknowledgeFailedTurn"), [["agent-ada", "turn-1"]]) &&
        acknowledgeEmpty.status === 400,
      [summary(acknowledge), summary(acknowledgeEmpty)],
    );
    const cancel = await call("POST", TEAM_API_ROUTES.agent.queueCancel("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1" },
    });
    check(
      "cancel gives 204 and names the delivery",
      cancel.status === 204 && isDeepStrictEqual(callsOf("cancelQueuedMessage"), [["agent-ada", "delivery-1"]]),
      summary(cancel),
    );
    const steer = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    const steerGone = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-gone"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    const steerDeferred = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-oc"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    check(
      "steer gives 204 for a listed agent, 404 for an agent that is not listed, and 409 with the reason when the provider defers steering",
      steer.status === 204 &&
        errorIs(steerGone, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(steerDeferred, 409, sourceText("error.backend.steerUnsupported")) &&
        isDeepStrictEqual(callsOf("steerQueuedMessage"), [
          [{ agentId: "agent-ada", deliveryId: "delivery-1", expectedTurnId: "turn-2" }],
          [{ agentId: "agent-oc", deliveryId: "delivery-1", expectedTurnId: "turn-2" }],
        ]),
      [summary(steer), summary(steerGone), summary(steerDeferred)],
    );
    const update = await call("POST", TEAM_API_ROUTES.agent.queueUpdate("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", text: "changed text", keepAttachmentIds: ["kept-1"], attachmentDraftIds: [] },
    });
    check(
      "update gives 204 and sends the text with the caller as sender",
      update.status === 204 &&
        isDeepStrictEqual(callsOf("updateQueuedMessage"), [
          [
            {
              agentId: "agent-ada",
              deliveryId: "delivery-1",
              text: "changed text",
              keepAttachmentIds: ["kept-1"],
              attachmentDraftIds: [],
            },
            bobSender,
          ],
        ]),
      { status: update.status, calls: callsOf("updateQueuedMessage") },
    );
    const updateTooLong = await call("POST", TEAM_API_ROUTES.agent.queueUpdate("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", text: "x".repeat(INPUT_LIMITS.messageText + 1) },
    });
    check(
      "update with a text over the limit gets 400 and reaches no service",
      updateTooLong.status === 400 && callsOf("updateQueuedMessage").length === 1,
      summary(updateTooLong),
    );
    const reorder = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: ["delivery-2", "delivery-1"] },
    });
    const reorderBad = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: "delivery-1" },
    });
    check(
      "reorder gives 204 with the new order, and a non-array order gets 400",
      reorder.status === 204 &&
        isDeepStrictEqual(callsOf("reorderQueue"), [
          [{ agentId: "agent-ada", deliveryIds: ["delivery-2", "delivery-1"] }],
        ]) &&
        reorderBad.status === 400,
      [summary(reorder), summary(reorderBad)],
    );
    const interrupt = await call("POST", TEAM_API_ROUTES.agent.interrupt("agent-ada"), {
      token: bobToken,
      json: { turnId: "turn-3" },
    });
    const interruptGone = await call("POST", TEAM_API_ROUTES.agent.interrupt("agent-gone"), {
      token: bobToken,
      json: { turnId: "turn-3" },
    });
    check(
      "interrupt gives 204 for a listed agent and 404 for an agent that is not listed",
      interrupt.status === 204 &&
        errorIs(interruptGone, 404, sourceText("error.team.agentNotFound")) &&
        isDeepStrictEqual(callsOf("interrupt"), [["agent-ada", "turn-3"]]),
      [summary(interrupt), summary(interruptGone)],
    );

    const unsupported = sourceText("error.team.queueEditUnsupported");
    const begin = { action: "begin", deliveryId: "delivery-1", editId: "edit-1" };
    const noCapability = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: begin,
      capabilities: [],
    });
    const oldProtocol = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: begin,
      protocol: 2,
    });
    check(
      "queue edit without the capability or below protocol 3 gets 400 queueEditUnsupported",
      errorIs(noCapability, 400, unsupported) &&
        errorIs(oldProtocol, 400, unsupported) &&
        callsOf("editQueuedMessage").length === 0,
      [summary(noCapability), summary(oldProtocol)],
    );
    const edit = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), { token: bobToken, json: begin });
    check(
      "queue edit begin gives 200 with the queue and the caller as sender",
      edit.status === 200 &&
        field(edit.body, "botId") === "agent-ada" &&
        isDeepStrictEqual(callsOf("editQueuedMessage").at(-1), ["agent-ada", begin, bobSender]),
      summary(edit),
    );
    const rejected = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: { ...begin, editId: "edit-rejected" },
    });
    check(
      "a queue edit that the queue refuses gets 409 with its reason",
      rejected.status === 409 &&
        field(rejected.body, "error") === "Queue edit rejected: another editor holds this message.",
      summary(rejected),
    );
    const editCalls = callsOf("editQueuedMessage").length;
    const malformed = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: { action: "replace", deliveryId: "delivery-1", editId: "edit-2" },
    });
    check(
      "a malformed queue edit on protocol 7 gets 400 and reaches no service",
      malformed.status === 400 && callsOf("editQueuedMessage").length === editCalls,
      summary(malformed),
    );
  }

  // ---- Attachments and files ----
  {
    const nameRequired = sourceText("error.team.attachmentNameRequired");
    const prepareCalls = () => callsOf("prepareImportedAttachments").length;
    const bytes = new TextEncoder().encode("hello attachment");
    const badNames = [
      await call("POST", TEAM_API_ROUTES.attachments, { token: bobToken, bytes }),
      await call("POST", `${TEAM_API_ROUTES.attachments}?name=${encodeURIComponent("../escape.txt")}`, {
        token: bobToken,
        bytes,
      }),
      await call("POST", `${TEAM_API_ROUTES.attachments}?name=${"n".repeat(INPUT_LIMITS.attachmentName + 1)}`, {
        token: bobToken,
        bytes,
      }),
    ];
    const longMime = await call(
      "POST",
      `${TEAM_API_ROUTES.attachments}?name=notes.txt&mime=${"m".repeat(INPUT_LIMITS.mimeType + 1)}`,
      { token: bobToken, bytes },
    );
    const noToken = await call("POST", `${TEAM_API_ROUTES.attachments}?name=notes.txt`, { bytes });
    check(
      "an upload with no name, a path in the name, a long name or a long MIME type gets 400, and one with no token 401",
      badNames.every((reply) => errorIs(reply, 400, nameRequired)) &&
        errorIs(longMime, 400, "The attachment MIME type is too long.") &&
        noToken.status === 401 &&
        prepareCalls() === 0,
      [...badNames, longMime, noToken].map(summary),
    );
    const oversized = await rawCall(
      `${TEAM_API_ROUTES.attachments}?name=big.bin`,
      bobToken,
      ATTACHMENT_LIMITS.fileBytes + 1,
      null,
    );
    check(
      "an upload that declares more than 100 MB gets 413 before its body is read",
      oversized.status === 413 &&
        field(oversized.body, "error") === "Attachment exceeds the 100 MB limit." &&
        prepareCalls() === 0,
      oversized,
    );
    const upload = await call("POST", `${TEAM_API_ROUTES.attachments}?name=notes.txt&mime=text%2Fplain`, {
      token: bobToken,
      bytes,
    });
    const preparedData = uploads[0];
    check(
      "an upload gives 201 with the draft, and the service gets the exact bytes",
      upload.status === 201 &&
        field(upload.body, "id") === "draft-1" &&
        field(upload.body, "size") === bytes.length &&
        preparedData?.name === "notes.txt" &&
        preparedData.mimeType === "text/plain" &&
        Buffer.from(bytes).equals(preparedData.bytes),
      summary(upload),
    );
    const download = await call("GET", TEAM_API_ROUTES.attachment("att-1"), { token: bobToken });
    check(
      "an attachment download gives the bytes, the MIME type and an encoded file name",
      download.status === 200 &&
        download.text === attachmentBytes &&
        download.headers.get("content-type") === "text/plain" &&
        download.headers.get("content-disposition") === "attachment; filename*=UTF-8''report%20one.txt",
      { status: download.status, headers: Object.fromEntries(download.headers) },
    );
    const missing = await call("GET", TEAM_API_ROUTES.attachment("att-missing"), { token: bobToken });
    check(
      "a missing attachment gets 404 attachmentNotFound",
      errorIs(missing, 404, sourceText("error.team.attachmentNotFound")),
      summary(missing),
    );
    const discard = await call("DELETE", TEAM_API_ROUTES.attachment("draft-1"), { token: bobToken });
    check(
      "deleting a draft attachment gives 204 and discards it",
      discard.status === 204 && isDeepStrictEqual(callsOf("discardDraftAttachment"), [["draft-1"]]),
      summary(discard),
    );

    const cancelCalls = callsOf("cancelQueuedMessage").length;
    const largeJson = new TextEncoder().encode(JSON.stringify({ deliveryId: "delivery-1", padding: "p".repeat(MIB) }));
    const tooLarge = await rawCall(
      TEAM_API_ROUTES.agent.queueCancel("agent-ada"),
      bobToken,
      largeJson.length,
      largeJson,
    );
    check(
      "a JSON body over 1 MiB gets 413 requestTooLarge and reaches no service",
      tooLarge.status === 413 &&
        field(tooLarge.body, "error") === sourceText("error.team.requestTooLarge") &&
        callsOf("cancelQueuedMessage").length === cancelCalls,
      tooLarge,
    );

    const sharedMissing = await call("GET", TEAM_API_ROUTES.sharedFiles, { token: bobToken });
    const shared = await call("GET", `${TEAM_API_ROUTES.sharedFiles}?path=shared.txt`, { token: bobToken });
    const sharedBig = await call("GET", `${TEAM_API_ROUTES.sharedFiles}?path=big.bin`, { token: bobToken });
    check(
      "shared files: no path gets 400, a file gives its bytes, a file over 100 MB gets 413",
      errorIs(sharedMissing, 400, "A valid shared file path is required.") &&
        shared.status === 200 &&
        shared.text === "shared file bytes\n" &&
        shared.headers.get("content-disposition") === "attachment; filename*=UTF-8''shared.txt" &&
        errorIs(sharedBig, 413, sourceText("error.team.sharedFileTooLarge")),
      [summary(sharedMissing), summary(shared), summary(sharedBig)],
    );
    const workspaceMissing = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?path=notes.md`, { token: bobToken });
    const workspace = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-ada&path=notes.md`, {
      token: bobToken,
    });
    const workspaceBig = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-ada&path=big.bin`, {
      token: bobToken,
    });
    check(
      "workspace files: no agent gets 400, a file gives its bytes, a file over 100 MB gets 413",
      errorIs(workspaceMissing, 400, "A valid agent id is required.") &&
        workspace.status === 200 &&
        workspace.text === "# workspace notes\n" &&
        errorIs(workspaceBig, 413, sourceText("error.team.workspaceFileTooLarge")),
      [summary(workspaceMissing), summary(workspace), summary(workspaceBig)],
    );
  }

  // ---- An unexpected failure is a private 500 with a redacted log ----
  {
    const loggedBefore = logged.length;
    const status = await call("GET", TEAM_API_ROUTES.agents.status, { token: bobToken });
    const newLines = logged.slice(loggedBefore);
    check(
      "an unexpected service error gets 500 requestFailed without its detail",
      errorIs(status, 500, sourceText("error.team.requestFailed")) && !status.text.includes(FAKE_SECRET),
      summary(status),
    );
    check(
      "the unexpected error is logged once with the secret redacted",
      newLines.some((line) => line.includes("Team API request failed")) &&
        newLines.every((line) => !line.includes(FAKE_SECRET)) &&
        newLines.some((line) => line.includes("[redacted]")),
      { lines: newLines.length },
    );
  }

  // ---- A direct message to a disabled member ----
  // Last, because disabling Ada ends her sessions.
  {
    await Effect.runPromise(store.updateMember(adaId, { disabled: true }));
    const loggedBefore = logged.length;
    const toDisabled = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: adaId, text: "hello disabled", clientMessageId: "client-message-4" },
    });
    const threadsAfter = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    check(
      "a direct message to a disabled member gets 404, is not stored and writes no error log line",
      errorIs(toDisabled, 404, sourceText("error.team.directRecipientUnavailable")) &&
        threadsAfter.status === 200 &&
        list(threadsAfter.body).length === 0 &&
        logged.slice(loggedBefore).every((line) => !line.includes("Team API request failed")),
      { toDisabled: summary(toDisabled), threadsAfter: summary(threadsAfter) },
    );
  }
  check(
    "no log line holds a session token, an invitation token or the fake secret",
    logged.every(
      (line) =>
        !line.includes(FAKE_SECRET) &&
        !line.includes(owner.sessionToken) &&
        !line.includes(adaToken) &&
        !line.includes(bobToken) &&
        !line.includes(adminInvite.token),
    ),
    { lines: logged.length },
  );
} finally {
  if (server) await Effect.runPromise(server.stop());
  database.close();
  rmSync(root, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
