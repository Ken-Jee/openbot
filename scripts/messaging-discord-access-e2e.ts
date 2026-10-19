// Checks two Discord servers on one OpenBot server, the role list of a Discord server, and the
// replied-to message as context. A Gateway event goes through Signal's normalizer
// (`remote/api/src/discord-events.ts`), a JSON round trip and the host's decoder, into the real
// Discord driver and messaging service on a temporary profile. Signal's API (`makeDiscordApi`) runs
// over a fake Discord REST client. No agent turn runs: the check reads the prompt that a turn would get.
// `bun scripts/messaging-discord-access-e2e.ts`. Writes .openbot-build/messaging-discord-access-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DISCORD_GATEWAY_INTENTS, DISCORD_MESSAGE_CONTENT_INTENT } from "@openbot/contracts/discord-app";
import { decodeDiscordApiError, decodeDiscordDelivery } from "@openbot/contracts/signal-protocol/discord-api";
import type { GatewayDispatchPayload } from "discord-api-types/v10";
import { Effect } from "effect";
import { type DiscordRestRequest, DiscordTransportError, makeDiscordApi } from "../remote/api/src/discord-api";
import { DiscordState } from "../remote/api/src/discord-events";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { discordDriver } from "../src/backend/messaging/discord/discord-driver";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import { MessagingThreads } from "../src/backend/messaging/messaging-threads";
import {
  DiscordApiError,
  type IngressHandler,
  MessagingAdapterError,
  type MessagingIngress,
} from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { parseSetDiscordAccessInput } from "../src/main/ipc/messaging-inputs";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-discord-access-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-discord-access-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const APP = "300000000000000001";
const GUILD_ONE = "100000000000000001";
// This guild's Signal is older than role lists: it refuses `listRoles`.
const GUILD_TWO = "100000000000000002";
const CHANNEL_ONE = "110000000000000001";
const CHANNEL_TWO = "110000000000000002";
const MAINTAINERS = "400000000000000001";
const MEMBERS = "400000000000000002";
const ANA = "500000000000000001";
const BOB = "500000000000000002";
const KAMIL = "500000000000000003";
// One author for each later queued mention: the service refuses a third waiting message of one author.
const EVA = "500000000000000004";
const OLA = "500000000000000005";
const IGA = "500000000000000006";

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { steps: Step[]; passed: boolean; unverified: string[] } = {
  steps: [],
  passed: false,
  unverified: [
    "The Discord Gateway and REST API: a fake REST client stands in for Discord, so the role IDs and the replied-to text in a real MESSAGE_CREATE are not checked here.",
    "The Signal ingress socket and the Gateway intent fallback (close code 4014): the check calls Signal's API and normalizer in this process.",
    "An agent turn: the check reads the prompt that the turn would get, and no provider runs.",
  ],
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Step = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

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
};

/** A Gateway event as Discord sends it. JSON, as on the wire. */
function gateway(t: string, d: unknown): GatewayDispatchPayload {
  return JSON.parse(JSON.stringify({ op: 0, s: 1, t, d }));
}

/** What the fake Discord REST client received, and a wait for one call. */
const calls: DiscordRestRequest[] = [];
const waiters: Array<{ match: (call: DiscordRestRequest) => boolean; resolve: () => void }> = [];
let nextMessageId = 600000000000000000n;

function waitForCall(match: (call: DiscordRestRequest) => boolean): Promise<void> {
  if (calls.some(match)) return Promise.resolve();
  return new Promise((done) => waiters.push({ match, resolve: done }));
}

/** Discord's REST API for the calls this check makes. */
const rest = {
  request: (input: DiscordRestRequest) =>
    Effect.suspend(() => {
      calls.push(input);
      for (const waiter of waiters.splice(0)) {
        if (waiter.match(input)) waiter.resolve();
        else waiters.push(waiter);
      }
      const route = input.route;
      if (input.method === "POST" && /^\/channels\/[0-9]+\/messages$/u.test(route)) {
        nextMessageId += 1n;
        return Effect.succeed({ id: nextMessageId.toString() });
      }
      if (route.includes("/reactions/")) return Effect.succeed({});
      if (/^\/channels\/[0-9]+\/messages$/u.test(route)) return Effect.succeed([]);
      const member = /^\/guilds\/[0-9]+\/members\/([0-9]+)$/u.exec(route);
      if (member) {
        const names: Record<string, string> = {
          [ANA]: "Ana",
          [BOB]: "Bob",
          [KAMIL]: "Kamil",
          [EVA]: "Eva",
          [OLA]: "Ola",
          [IGA]: "Iga",
        };
        const id = member[1] ?? "";
        return Effect.succeed({ nick: null, user: { id, username: names[id] ?? id } });
      }
      if (route === `/guilds/${GUILD_ONE}/roles`)
        return Effect.succeed([
          { id: GUILD_ONE, name: "@everyone", position: 0 },
          { id: MEMBERS, name: "Members", position: 1 },
          { id: MAINTAINERS, name: "Maintainers", position: 2 },
          { id: "400000000000000009", name: "OpenBot", position: 3, managed: true },
        ]);
      return Effect.fail(new DiscordTransportError({ status: 404 }));
    }),
};

// Signal's state and API, after the Gateway's READY and the two guilds.
const signal = new DiscordState(APP);
signal.handle(
  gateway("READY", {
    v: 10,
    user: { id: APP, username: "OpenBot", bot: true },
    application: { id: APP, flags: 0 },
    guilds: [
      { id: GUILD_ONE, unavailable: true },
      { id: GUILD_TWO, unavailable: true },
    ],
    session_id: "session",
    resume_gateway_url: "wss://gateway.discord.gg",
    shard: [0, 1],
  }),
);
for (const [guildId, channelId, name] of [
  [GUILD_ONE, CHANNEL_ONE, "Nightly"],
  [GUILD_TWO, CHANNEL_TWO, "Labs"],
] as const)
  signal.handle(
    gateway("GUILD_CREATE", { id: guildId, name, channels: [{ id: channelId, type: 0, name: "general" }] }),
  );
const signalApi = makeDiscordApi(rest, signal);

/** The relay as Signal drives it, with Signal's API answering the host's Discord calls. */
let relayHandler: IngressHandler | null = null;
const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "online",
  onState: () => () => {},
  handle: (handler) => {
    relayHandler = handler;
  },
  telegram: { available: () => false, call: unused, download: unused, upload: unused },
  reconnect: () => {},
  onDiscordRoutes: () => () => {},
  discord: (request, decode) => {
    // An older Signal does not know `listRoles` and refuses it as an invalid request.
    if (request.op === "listRoles" && request.guildId === GUILD_TWO)
      return Effect.fail(new MessagingAdapterError({ cause: new DiscordApiError(request.op, "invalid_request") }));
    return signalApi.call(request, null).pipe(
      Effect.map((result) => decode(JSON.parse(JSON.stringify(result)))),
      Effect.mapError((failure) => {
        const body = decodeDiscordApiError({ error: { code: failure.code } });
        return new MessagingAdapterError({ cause: new DiscordApiError(request.op, body?.code ?? "discord_failed") });
      }),
    );
  },
};

function memoryCredentials(): MessagingCredentials {
  const values = new Map<string, Record<string, string>>();
  return {
    keys: () => [...values.keys()],
    status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
    get: (connectionId) => values.get(connectionId) ?? null,
    set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
    clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
    retain: (connectionIds) =>
      Effect.sync(() => {
        for (const key of values.keys()) if (!connectionIds.has(key)) values.delete(key);
      }),
  };
}
const credentials = memoryCredentials();

interface Booted {
  messaging: MessagingService;
  threads: MessagingThreads;
  mailbox: MailboxStore;
}

async function boot<T>(use: (services: Booted) => Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  // Its own threads, which start no turn: no provider runs in this check.
  const threads = new MessagingThreads(store.database, mailbox, {
    schedule: () => {},
    queueChanged: () => {},
    busy: () => false,
    interrupt: unused,
    forgetThread: () => Effect.void,
    ownChat: () => false,
  });
  const messaging = new MessagingService({
    threads,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) => agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [discordDriver({ ingress })],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    sidebar,
  });
  await runCauseEffect(messaging.start());
  try {
    return await use({ messaging, threads, mailbox });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

interface Mention {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  roles?: string[];
  content: string;
  replyTo?: { id: string; authorId: string; authorName: string; content: string };
}

/** One MESSAGE_CREATE that mentions OpenBot, through Signal and the relay. Returns Signal's delivery. */
async function mention(message: Mention) {
  const actions = signal.handle(
    gateway("MESSAGE_CREATE", {
      id: message.id,
      channel_id: message.channelId,
      guild_id: message.guildId,
      content: `<@${APP}> ${message.content}`,
      timestamp: "2026-10-19T11:47:00.000Z",
      author: { id: message.authorId, username: message.authorName },
      ...(message.roles ? { member: { nick: null, roles: message.roles } } : {}),
      mentions: [{ id: APP }],
      attachments: [],
      ...(message.replyTo
        ? {
            message_reference: { type: 0, message_id: message.replyTo.id },
            referenced_message: {
              id: message.replyTo.id,
              content: message.replyTo.content,
              timestamp: "2026-10-19T11:40:00.000Z",
              author: { id: message.replyTo.authorId, username: message.replyTo.authorName },
            },
          }
        : {}),
    }),
  );
  const action = actions[0];
  assert.ok(action?.type === "deliver", "Signal did not pass the mention on.");
  const delivery = decodeDiscordDelivery(JSON.parse(JSON.stringify(action.delivery)));
  const handler = relayHandler;
  assert.ok(handler, "The messaging service has no relay handler.");
  const answer = await runCauseEffect(handler(action.guildId, { platform: "discord", delivery }));
  assert.equal(answer.status, 200);
  return delivery;
}

/** The service reacts 👀 to a message it queued, and something else to a message it refused. */
const received = (messageId: string) =>
  waitForCall(
    (call) =>
      call.method === "PUT" && call.route.includes(`/messages/${messageId}/reactions/${encodeURIComponent("👀")}/`),
  );

/** Whether OpenBot reacted to the message, or posted a reply to it. */
function touched(messageId: string): boolean {
  return calls.some(
    (call) => call.route.includes(`/messages/${messageId}`) || JSON.stringify(call.body ?? null).includes(messageId),
  );
}

async function promptOf(services: Booted, guildId: string, mentionId: string, channelId: string): Promise<string> {
  const record = services.threads.store.connectionForWorkspace("discord", guildId);
  assert.ok(record);
  const context = services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${channelId}:${mentionId}`);
  assert.ok(context, "The mention has no delivery.");
  const prepared = await runCauseEffect(services.threads.prepare(context));
  assert.ok(prepared, "The delivery has no prompt.");
  return prepared.text;
}

let messageId = 700000000000000000n;
const nextId = () => {
  messageId += 1n;
  return messageId.toString();
};

try {
  await step("the intents ask for Message Content only with the flag", async () => {
    assert.equal(DISCORD_GATEWAY_INTENTS & DISCORD_MESSAGE_CONTENT_INTENT, 0);
    assert.equal(DISCORD_MESSAGE_CONTENT_INTENT, 1 << 15);
    return { base: DISCORD_GATEWAY_INTENTS, messageContent: DISCORD_MESSAGE_CONTENT_INTENT };
  });

  // Two Discord servers connect to one OpenBot server, as after two installs.
  await boot(async ({ threads }) => {
    for (const [guildId, name] of [
      [GUILD_ONE, "Nightly"],
      [GUILD_TWO, "Labs"],
    ] as const) {
      const record = threads.store.ensureConnection("discord", guildId, name);
      threads.store.updateConnection(record.connectionId, { enabled: true });
      await runCauseEffect(credentials.set(record.connectionId, { guildId, guildName: name, appId: APP }));
    }
  });

  await boot(async (services) => {
    const { messaging } = services;

    await step("two Discord servers connect, each with its own orchestrator", async () => {
      const overview = messaging.discordOverview().connections;
      assert.equal(overview.length, 2);
      assert.ok(overview.every((connection) => connection.state === "connected"));
      const one = await runCauseEffect(messaging.addOrchestrator("discord", { workspaceId: GUILD_ONE }));
      const two = await runCauseEffect(messaging.addOrchestrator("discord", { workspaceId: GUILD_TWO }));
      assert.notEqual(one.agentId, two.agentId, "Both servers share one orchestrator.");
      return { connections: overview.map((connection) => connection.workspaceId), agents: 2 };
    });

    await step("with no role list, anyone's mention is queued", async () => {
      const id = nextId();
      await mention({
        id,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [],
        content: "hello",
      });
      await received(id);
      return { messageId: id };
    });

    await step("Signal lists the roles a person can have, highest first", async () => {
      const list = await runCauseEffect(messaging.listDiscordRoles(GUILD_ONE));
      assert.deepEqual(list.roles, [
        { id: MAINTAINERS, name: "Maintainers" },
        { id: MEMBERS, name: "Members" },
      ]);
      return list;
    });

    await step("an older Signal: the role list gives the unsupported text", async () => {
      const failure = await runCauseEffect(messaging.listDiscordRoles(GUILD_TWO)).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      assert.equal(failure, "OpenBot cannot list Discord roles yet. Try again later.");
      return { failure };
    });

    await step("the IPC decoder refuses a role list with a repeated role", async () => {
      assert.throws(() =>
        parseSetDiscordAccessInput({
          workspaceId: GUILD_ONE,
          allowedRoles: [
            { id: MAINTAINERS, name: "Maintainers" },
            { id: MAINTAINERS, name: "Maintainers" },
          ],
        }),
      );
      assert.deepEqual((await runCauseEffect(messaging.discordAccess(GUILD_ONE))).allowedRoles, []);
      return { refused: true };
    });

    await step("with a role list, only members with one of its roles reach OpenBot", async () => {
      const input = parseSetDiscordAccessInput({
        workspaceId: GUILD_ONE,
        allowedRoles: [{ id: MAINTAINERS, name: "Maintainers" }],
      });
      const saved = await runCauseEffect(messaging.setDiscordAccess(input));
      assert.deepEqual(saved.allowedRoles, [{ id: MAINTAINERS, name: "Maintainers" }]);

      const outsider = nextId();
      await mention({
        id: outsider,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [MEMBERS],
        content: "do it",
      });
      const unknownRoles = nextId();
      // A mention from an older Signal has no roles.
      await mention({
        id: unknownRoles,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        content: "do it",
      });
      const maintainer = nextId();
      await mention({
        id: maintainer,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: ANA,
        authorName: "Ana",
        roles: [MEMBERS, MAINTAINERS],
        content: "do it",
      });
      await received(maintainer);
      // The role check runs before the first await, so the ignored mentions are decided by now.
      assert.equal(touched(outsider), false, "OpenBot reacted or replied to a member without a listed role.");
      assert.equal(touched(unknownRoles), false, "OpenBot reacted or replied to a mention without roles.");
      const record = services.threads.store.connectionForWorkspace("discord", GUILD_ONE);
      assert.ok(record);
      assert.equal(
        services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${outsider}`),
        null,
      );
      assert.equal(
        services.mailbox.deliveryForKey(`messaging:${record.connectionId}:${CHANNEL_ONE}:${unknownRoles}`),
        null,
      );

      // The other Discord server has no list.
      const other = nextId();
      await mention({
        id: other,
        guildId: GUILD_TWO,
        channelId: CHANNEL_TWO,
        authorId: BOB,
        authorName: "Bob",
        roles: [],
        content: "hi",
      });
      await received(other);
      return { ignored: [outsider, unknownRoles], queued: [maintainer, other] };
    });

    await step("a reply to a person's message gives that message as context", async () => {
      const replied = nextId();
      const id = nextId();
      await mention({
        id,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: EVA,
        authorName: "Eva",
        roles: [MAINTAINERS],
        content: "make an issue for this",
        replyTo: {
          id: replied,
          authorId: KAMIL,
          authorName: "Kamil",
          content: `Feature idea: webhooks for OpenBot. <@${BOB}> agrees.`,
        },
      });
      await received(id);
      const prompt = await promptOf(services, GUILD_ONE, id, CHANNEL_ONE);
      assert.match(
        prompt,
        /--- the message this one replies to \(context\) ---\n\[2026-10-19T11:40:00\.000Z\] Kamil: Feature idea: webhooks for OpenBot\. @Bob agrees\.\n--- message ---\nmake an issue for this/u,
      );
      assert.doesNotMatch(prompt, /earlier messages in this conversation/u);

      const plain = nextId();
      await mention({
        id: plain,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: OLA,
        authorName: "Ola",
        roles: [MAINTAINERS],
        content: "status?",
      });
      await received(plain);
      assert.doesNotMatch(await promptOf(services, GUILD_ONE, plain, CHANNEL_ONE), /replies to/u);
      return { replyContext: true };
    });
  });

  await boot(async (services) => {
    await step("after a restart, the role list stays; an empty list lets everyone again", async () => {
      const access = await runCauseEffect(services.messaging.discordAccess(GUILD_ONE));
      assert.deepEqual(access.allowedRoles, [{ id: MAINTAINERS, name: "Maintainers" }]);
      assert.deepEqual((await runCauseEffect(services.messaging.discordAccess(GUILD_TWO))).allowedRoles, []);
      const outsider = nextId();
      await mention({
        id: outsider,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [MEMBERS],
        content: "again",
      });
      const maintainer = nextId();
      await mention({
        id: maintainer,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: IGA,
        authorName: "Iga",
        roles: [MAINTAINERS],
        content: "again",
      });
      await received(maintainer);
      assert.equal(touched(outsider), false);

      // An empty list lets everyone again.
      await runCauseEffect(services.messaging.setDiscordAccess({ workspaceId: GUILD_ONE, allowedRoles: [] }));
      const everyone = nextId();
      await mention({
        id: everyone,
        guildId: GUILD_ONE,
        channelId: CHANNEL_ONE,
        authorId: BOB,
        authorName: "Bob",
        roles: [],
        content: "now?",
      });
      await received(everyone);
      return { allowedRoles: access.allowedRoles };
    });
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
// The report names steps and ids only: no message text.
assert.ok(!readFileSync(REPORT, "utf8").includes("webhooks for OpenBot"), "The report contains message text.");
process.stdout.write(`Discord access check passed. Report: ${REPORT}\n`);
