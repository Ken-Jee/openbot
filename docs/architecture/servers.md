# Servers, storage, and billing

## Storage and files

Three surfaces show what a host keeps on disk: Server Settings > Storage (scope `host`), Agent
settings > Files (scope `agent`) and the chat Files panel (scope `conversation`). They share
`src/renderer/src/features/files/storage-usage.ts`, which names the server explicitly, because Server
Settings can be open for a server that is not the selected one.

`src/backend/storage-usage.ts` owns the scan and has no Electron imports. Sent and generated files
come from the mailbox state in memory, with their chat from paged read-only queries in
`database/storage-usage-queries.ts`; a file's status comes from `lstat`, not from
`resolveAttachment`, which hashes the file. Workspaces, shared files, downloads, caches, logs and
runtimes are measured by a bounded walk: `lstat`, no symlinks followed, a stop at 100,000 entries,
and a yield between pages, because `DatabaseSync` and the walk run on the main thread. A result is
cached for 60 seconds per scope, a scan in progress is shared, and a delete, clear or agent delete
drops the cache. Lists stop at `STORAGE_LIMITS` and set `truncated`; the breakdown still counts
every byte.

A delete does not change the schema. `MailboxStore.deleteStoredFile` sets `deletedAt` on the stored
attachment, persists, and queues the file path, not the transfer folder, in the file-deletion outbox.
It keeps a path that another live record uses, and it deletes only a real path under the Transfers
folder. `resolveAttachment` then returns null, so a file card shows "File not found" and a generated image
shows its unavailable state. An older app ignores the field. Clear removes the remote-server caches and the `logs/remote`,
`logs/update`, `logs/providers` and `logs/agents` files; it does not enter `logs/remote/transfers`. Runtimes are read-only.

`storage:*` IPC reaches the local service or a joined server. The optional `storage-v1` capability
exposes `POST /v1/storage/usage`, `/v1/storage/delete-file` and `/v1/storage/clear` with the frozen
codec in `team-protocol/storage-v1.ts`. The host advertises it only when its storage service
exists. Every member reads usage; delete and clear need an owner or admin (`requireAdmin`), and the
renderer hides those controls from a member. The wire carries no absolute paths, and workspace and
download files travel only as category totals. A host without the capability reads as null, and the
surface asks for an update; a change is refused before any request.

### Hosted sites per server

A hosted site belongs to the server that published it (`hosted_sites.server_id`, D1 `0024`). The user
stays the accountable owner, for abuse reports, blocks and account deletion. The desktop sends
`OpenBot-Host-Id` and `OpenBot-Host-Token` (the machine token of `/v2/remote/hosts/register`) on each
`/v1/sites` request when it is a registered server. The Worker checks the hash and that the host owner
is the request user; a wrong token is refused with 401, never counted as unlinked. The active-site
limit comes from the server's plan (`siteLimitForPlan`: none 1, Starter 3, Standard 10, Pro 50). A
request with no server headers creates only into the account's unlinked bucket (limit 1,
`server_id IS NULL`); with no `?scope=unlinked`, it still lists and deletes every site of the account,
the released meaning of `/v1/sites`. Replace and delete in a server scope refuse a site of another
bucket with 409 `site_other_server`. A downgrade deletes nothing: a server above its limit cannot
create a site, but it can replace one, and the extra sites end at their expiry. Removing a server moves its sites to the owner's unlinked bucket, so the owner's desktop can still delete them. A registered server updates a site that it published before registration in the unlinked scope.

`hostedSites.list` and `hostedSites.delete` IPC are server-scoped; publish and replace stay local. The
optional `hosted-sites-v1` capability exposes `POST /v1/hosted-sites/list` for every member and
`POST /v1/hosted-sites/delete` for an owner or admin, with the frozen codec in
`team-protocol/hosted-sites-v1.ts`. The host answers with its own account and credential, and only with the server's own sites: the owner's unlinked sites never reach a member, and the Team API has no fallback to delete one. Sites are
managed in Server settings > Sites, on the desktop and in the browser.

### Leaving a server

Leaving a joined server has the same effect as an admin removal: the membership and every session of
it end, on all of the member's devices. On WebRTC, the account service revokes the membership, as it
does for the owner's removal. On HTTP, `member-leave-v1` adds a bodyless `POST /v1/team/leave`, which
runs the steps of the admin `DELETE /v1/team/members/:id` for the caller; the owner is refused. A host
without the capability answers 404, so the client only logs out: that token stops working, and the
membership stays for an admin to remove. Either way the client removes the server, also when the host
does not answer.

### New chat

`context-reset-v1` adds `POST /v1/agent-context/clear` with `{ agentId }`. Any member who can see the
agent can send it. The host writes a system message with `itemType: "context-reset"` to the agent's own
thread and ends that thread's provider sessions. The thread, its messages and the agent do not change.
The next provider session gets a handoff of only the messages after the last marker. The host refuses
the request while a turn runs or a message waits in the queue. A client without the capability shows
the marker as its text. Channel execution threads are not reset.

### Workspace folders

`workspace-directory-v1` adds `POST /v1/workspace-directory` with `{ agentId, path }`. Any member who
can see the agent can send it, as with `GET /v1/workspace-files`. The host answers the folder entries
(name, path, kind, size, modification time), at most 500, directories first. The path must stay inside
the agent workspace; a symbolic link that leaves it is not listed. A missing path answers 404 with a
message that names the path and the workspace. A client without the capability shows the file preview
error. The desktop lists a local folder without the containment when the agent has no workspace limit.

### Conversation files

`conversation-file-search-v1` adds `POST /v1/conversation-files/search` with `{ query, cursor, limit? }`.
Any member can send it. The host answers the files of agent chat messages whose name contains the
query, newest first, with the agent, the message, the time and the attachment summary. An empty query
lists the newest files. A page has at most 100 results (50 when `limit` is absent), and `nextCursor`
gets the next page. Channel threads and the files of an agent hidden from the client are not listed.
The capability is advertised only to protocol 7 clients. An older host answers 404, so a client
sends the request only when the host advertises the capability.

### Agent import from a joined server

`agent-import-v1` lets any member, not only an owner or admin, import a Grok Bot export into the host.
`POST /v1/agent-import/stage` takes the raw `.zip` (at most 100 MB) and answers the preview without
avatars, so the preview stays under the 2 MB WebRTC frame limit. `AgentImportService.stageUpload` writes
the file to `agent-import-uploads/` in the host's user data and keeps it under a token that only the
caller's member id can apply or discard. One member keeps one export, the host keeps four uploads at
most, and an upload nobody applies is released after 30 minutes; the folder is cleared on the first
upload after a restart. `POST /v1/agent-import/apply` takes `{ token, keys, channelKeys, timezone }` and
answers the new agents by id and name, which the client reads with the agent list. Channels are created
with the member as the actor. A member never revises a skill already in the host library: the agent
gets the existing skill and the result warns. `POST /v1/agent-import/discard` releases the token. On
desktop, main opens the dialog, reads the file and sends it (`agent-import:choose` is server-scoped);
the web client uses the browser chooser and ships the export skill in its bundle.

### Instance transfer with a joined server

`instance-transfer-v1` moves a server's agents and server settings to or from an OpenBot transfer file
(see [Instance transfer](agents.md#instance-transfer)). Only an owner or admin can use it: the file holds
every agent's memories and files, and an import adds server settings. It is protocol 7 only. Every file
that crosses the connection is at most 100 MB, the size of one WebRTC file transfer; a computer's own
server keeps the 2 GB limit. `POST /v1/instance-transfer/summary` lists the agents with their counts and
no avatar address. `POST /v1/instance-transfer/export` takes `{ agentIds, includeFiles, includeSettings }`,
writes the file to `instance-transfer-uploads/` in the host's user data, sends it as an attachment and
removes it. `POST /v1/instance-transfer/stage` takes the raw `.zip` and answers the preview without
avatars, under a token that only the caller can apply or discard; an upload nobody applies is removed
after 30 minutes. `POST /v1/instance-transfer/apply` takes `{ token, keys, includeSettings, timezone }`
and answers the new agents by id and name, which the client reads with the agent list.
`POST /v1/instance-transfer/discard` releases the token. On desktop, main opens both dialogs and moves
the file (`instance-transfer:*` is server-scoped). The web client does not show the Transfer section: its
downloads are limited to 10 MB.

After a restart, the first upload or export removes old files from `instance-transfer-uploads/`,
including unfinished `.part` files, before it writes a new file. Concurrent uploads and exports wait
for this cleanup. If cleanup fails, the operation fails; the next upload or export retries it.
Later operations keep the current process's files. Local files selected by the user are kept.

### Routine flows

`routine-flows-v1` serves the routine canvas (see [Routine flows](agents.md#routine-flows)) to a
joined desktop and to the web client. Its routes are `POST /v1/routine-flows/canvas`,
`/positions/save`, `/positions/remove`, `/links/connect`, `/links/disconnect` and `/links/update`,
with the input in the body. Any member who can see the agents can read and change a canvas, as with
the agent routine routes; it is not an admin capability. A member sees a routine only when every
agent it touches is visible, and the host answers a hidden or unknown agent, routine or link with
404. A webhook trigger's URL goes only to an owner or admin; a member reads it as null. Step input,
output and error cross with at most 4,000 characters each, and the host empties the step texts of the
routines with the oldest runs first when a canvas would pass three quarters of one WebRTC frame. The
optional event `routine-flows-changed { agentId }` names the canvas that changed; the host sends it
only to a connection with the capability and never for a hidden agent. Webhook config, secret
rotation and webhook test runs stay on `events-v1`. A client without the capability shows a notice
in the Routines view; the web client shows the view switch only when the host serves it.

### History extent

`history-extent-v1` lets the chat's scroll rail draw the history that is not loaded on a joined server.
It adds `olderCount` and `oldestAt` (at most 64 characters) beside the frozen keys of `pageInfo` on
`GET /v1/agents/:id/conversation-page` and `GET /v1/direct/conversations/:id/page`, and at the top
level of the `POST /v1/channels/read` page. The host adds them only on protocol 7 and only when the
request advertises the capability, so a released client reads the same bytes as before. A host
without the capability never sends them, so a client keeps them whenever they are present, and a
malformed value fails closed. The WebRTC host peer encodes the local response again with the same
option, so the fields reach the web client and a joined desktop through the data channel too.

### UI blocks

`ui-blocks-v1` carries the interactive block of an `ask_ui` question prompt (see
`packages/contracts/src/ui-blocks.ts`). It adds `uiBlock` beside the frozen keys of a message in
`GET /v1/agents/:id/conversation` and `conversation-page` (messages and references), and in the
`conversation` and `conversation-page` events. The host adds it only on protocol 7 and only for a
connection that advertises the capability. A released client reads the message as its fallback: a
question prompt that it answers through the released prompt route, and the host reads the block's
answer from those answers. A host without the capability never sends `uiBlock`, so a client keeps it
whenever it is present, and a block that the contract refuses fails closed. A privileged action (a
`danger` button, a button with `confirm`, or the primary button of a `danger` confirm), and an answer
in words on a block that has one, is for the owner and admins only; the host answers a member with
403. A secret form value goes to the agent in the tool result. The stored block and the prompt
resolution leave it out. The provider transcript of the tool call can keep it, and the agent can
repeat it in a reply or a thought, which the conversation stores as any other message.

### Queue window

`queue-window-v1` keeps the queue snapshot of a long-lived agent inside one WebRTC frame. The
mailbox keeps every finished delivery, and the released `GET /v1/agents/:id/queue` answers all of
them. After some weeks of use, that answer is larger than the 2 MiB JSON frame, so the host peer
answers `error.remote.responseTooLarge` and the phone and the web client cannot read the queue.

On protocol 7, when the request advertises the capability, `GET /v1/agents/:id/queue` and
`POST /v1/agents/:id/queue/edit` keep every queued, starting and running delivery, the `editing`
mark included. Then they keep every failed, interrupted and cancelled delivery, newest first, while
it fits in `WEBRTC_FRAME_BODY_BUDGET`: the phone and the web client show the failure reason of a
failed message, and hide a cancelled message, at any age. Only completed deliveries leave the
window: the newest 100 by `createdAt` stay, while they fit, for the receipts of recent messages.
The kept deliveries stay in queue order, and the wire shape and keys do not change. A request
without the capability, and every protocol 6 or older request, gets the full list as before.

Every current client sends `teamCapabilitiesForProtocol(7)`, so the phone, the web client and a
joined desktop get the window without other client code. A released phone keeps the full list
until it updates. `scripts/queue-window-e2e.ts` checks the frame size with and without the
capability.

### Browser control and page state

The frozen `browser-changed` event and `GET /v1/browser/tabs` drop unknown tab keys in released
clients, so two optional capabilities send their tab state on their own event and routes. A client
merges it into the tab list: the desktop main process in `remote-server-event-refresh.ts`, and the
web client in `web-client-context.tsx` and `web-runtime.ts`. A member does not see a private tab in
either one.

`browser-user-control-v1` lets any member who can see a tab take it from its agent and give it back:
`POST /v1/browser/user-control` (state), `/take` and `/release`, each with `{ tabId }` except the
state, and each answering with the held tab ids. While a person holds a tab, the owning agent's
browser tool calls on it wait until the release. The host refuses a take while a secret request is
active on the tab, and releases the holds of a session when it ends. Each change sends
`browser-user-control-changed { tabIds }`.

`browser-page-state-v1` adds `POST /v1/browser/page-state` (empty body) and `POST /v1/browser/stop`
(`{ tabId }`). Both answer with `{ tabs: [{ tabId, canGoBack, canGoForward }] }`, and each change
sends `browser-page-state-changed` with the same list. A stop ends the load at once, before the queued
tab operations, and a stop of a tab that does not load changes nothing. A client shows Stop only for a
host that reports the page state; for an older host, Back and Forward stay enabled.

### Skill events

`skills-events-v1` adds one optional event, `skills-changed { agentId }`. The host sends it after
each change to the installed skills of an agent: install, update, uninstall, turning a skill on or
off, and a skill an agent creates. `SkillMarketplaceService` calls its refresh callback after every
write, and that callback emits the event through `AgentService`, so this computer's windows get it
too. The event carries no skill data: a client reads the list again through `installed-skills` or
`skills-admin-v1`. `team-protocol/optional-events.ts` is the one place where each transport
recognizes the optional events that the frozen base vocabularies reject.

### Focus use

`focus-use-v1` adds `POST /v1/client/focus` with an empty body. Only a hosted server advertises it
(`focusUse` in `TeamApiOptions`), and the capability is v7 only. A client sends it while its app has
focus and the server is online, through `createFocusUsePing` in `packages/team-client`: the desktop
main process, the web client and the mobile app each give it their own focus signal and transport.
The host keeps the focus period of each session apart from `#sessionUse`, so a focused desktop does
not stop the phone's push notifications. A ping moves `lastClientUseAt` only for 30 minutes after the
later of the last user action of its session and the start of its focus period. The route is in `PASSIVE_ROUTES`, so the generic client use path
does not count it. See [hosted servers](../hosted-servers.md) step 5.

### Admin capabilities

An owner or admin of a joined server manages its host through optional `POST /v1/admin/...` routes.
Each capability has a frozen codec in `team-protocol/<name>-v1.ts`, registered in
`team-protocol/optional-routes.ts`, and both transports use it. Every route calls `requireAdmin`. The
host advertises a capability only when its `TeamApiAdmin` member exists.

| Capability | Grants | IPC group |
| --- | --- | --- |
| `agent-admin-v1` | Agent access and auto-approve | `agentAdmin` |
| `agent-host-settings-v1` | Agent Computer Use, local scripts, and messages while it works; reads the host default | `agentAdmin` |
| `skills-admin-v1` | List, install, remove, enable skills by marketplace id | `agentAdmin` |
| `shared-tables-v1` | List and delete shared tables | `sharedTables` |
| `agent-install-v1` | Add an agent from a listing or a shared template, by id | `agentAdmin` |
| `agent-update-v1` | Update an agent added from a listing to the listing's current version, by id | `agentAdmin` |
| `providers-v1` | Code sign-in, provider API keys, managed runtimes, custom endpoints | `providerAdmin` |
| `instance-transfer-v1` | Export and import the server's agents and server settings as a transfer file | `instanceTransfer` |
| `providers-v3` | Code sign-in for Codex, Claude and Grok; send the code a Claude sign-in page shows | `providerAdmin` |
| `providers-v4` | Code or link sign-in and managed runtimes, Cursor and Cline included | `providerAdmin` |
| `host-admin-v1` | Server name and logo | `hostAdmin` |
| `host-update-v1` | Check for, download and restart into an app update; cancel a restart that waits | `hostAdmin` |
| `host-timezone-v1` | Read and set the server timezone | `hostAdmin` |
| `agent-memory-limit-v1` | Read and set how many memories each agent keeps | `hostAdmin` |
| `discord-access-v1` | Read and set which Discord roles can use OpenBot in a Discord server; list its roles | `messaging` |
| `events-v1` | Manage webhook routines, their secrets, and activity | `events` |
| `routine-recovery-v1` | Read and set a routine's missed-run policy; read its runs with the missed occurrences | `events` |

These IPC groups take a required server id and route with `scopedHandler`. A key travels only towards
the host; no response carries one. `providers-v1` has no progress event, so the renderer reads runtime
status again every second while a host download runs. Publishing, macOS permissions, the browser
sign-in and folder import stay on the host.

`providers-v1` signs in Codex only, with a device code. A host that serves `providers-v3` also signs
in Grok (`grok login --device-auth`) and Claude (`claude auth login`), for a host with no visible
browser, such as a hosted server. `src/backend/agent/cli-code-login.ts` reads the link, and for Grok
the code, from the CLI output. The Claude CLI shows its paste prompt only on a terminal, so the host
runs it under the util-linux `script`, and the admin sends back the code that the Claude page shows
(`code-login/submit`). This flow runs only on a Linux host: the macOS `script` refuses a socket for
stdin, and Windows has no `script`. So only a Linux host advertises `providers-v3`; a macOS or
Windows host keeps `providers-v1`, and its clients offer the Codex code sign-in only. The CLI output and the pasted code are secrets; no log line or
error quotes them. How a sign-in ends arrives in the host's agent status, as for Codex.
`serverCodeRouteProviders` in `server-capabilities.ts` picks the providers that the Providers list offers
for a code sign-in, from the host's capabilities.

`providers-v4` adds Cursor and Cline to the sign-in and to the runtime routes. Every host with
provider admin advertises it, so a client offers the Claude sign-in only when the host also has
`providers-v3`. Cursor uses a `link` sign-in: the host runs `cursor-agent login` with
`NO_OPEN_BROWSER=1`, which prints the sign-in page and waits until the page signs the CLI in, so
the admin only opens the page. The ACP `cursor_login` method stops when it cannot open a browser,
so a peer never starts it. Cline uses a device code: the host runs `cline auth -p cline`, which
prints the code before its page. The parser accepts a link only after its line ends, because a
chunk can stop inside one.

When the account is an owner or admin of the active remote server, the server serves `providers-v1`,
and the server has no agent, the workspace shows `ServerOnboarding` before the first-agent form, on
desktop (`WorkspaceServerOnboarding`) and on the web (`WebWorkspace`). It shows the host's providers
through `hostSetupProviderProps`, and Continue stays blocked until a provider is connected. The form
then opens with that provider. The choice stays in memory for the server; it is not written to the
setup file of this computer. A member, the local server, and a host without `providers-v1` open the
form directly.

`host-timezone-v1` reads and sets the server timezone (`openbot-server-timezone-v1.json`; `null` is
automatic, the system zone of the host). When an agent creates a routine, the zone comes from the tool
call first, then from the sender's last message in that turn, then from this setting. The sender's
zone stays in memory only, so after a restart a queued message uses the server timezone. Agent import
and instance transfer use it in place of the system zone. A change does not move existing routines.

`agent-memory-limit-v1` reads and sets how many memories each agent of the host can keep. It is the
same value as "Memories per agent" in the host's own Settings. The snapshot gives the limit and the
values that the host permits; the host refuses other values. A change reloads the threads of each
agent, because their instructions state the limit, and the host's Settings window shows the new value
(`app:agent-memory-limit`). A lower limit deletes no memories. The limit
does not change the 8,192-byte budget of essential memories. The desktop shows the row for a joined
server only; App Settings holds the value of this computer.

`host-update-v1` runs the same update as the host's own Settings. `src/main/requested-update.ts`
keeps the schedule in memory: who asked, and whether the restart waits until
`describeRestartReadiness` reports no running work or happens as soon as the update is ready. The
host user can turn the routes off with "Allow updates from server members" (`openbot-update-preference-v1.json`,
default on) and can cancel a restart that waits. The host still advertises the capability when the
setting is off, so the client can show why. A Host Manager tenant refuses the routes. The client
reads the status again every second while a check, a download or a restart runs. An admin can also
set the host's automatic download and automatic install when idle through the settings route; an
automatic install is a schedule with no requester.

`server-update-flow.tsx` reads the update status once on each connection of a member with update access.
The sidebar header then shows an update button next to the server name. Each time the user enters a server
that has a new version, the update dialog opens again; it stays closed on a reconnect to the same server. The dialog confirm calls `start`, which downloads and restarts in one call. The
dialog reads the status while the update runs and follows the connection until the host is back with
the new version. A hidden dialog keeps a notice with the live status, also after a server switch on desktop; entering the server then does not open the dialog again. The web client reads only the connected host, so it stops following the update when the user leaves that server; the header button shows the update again on return. A host that still waits to restart after a connection drop did not restart. All members get the `host-restart` event
(`waiting`, `restarting`, `none`) from the host's event stream, and the host sends the current state
again when a client declares the capability. Like `channelEvent`, the event skips the frozen v1-v3
event encoders at each hop (host peer, client transport, `remote-peer.ts`, SSE stream). A client that
loses the host while a restart waits treats it as the restart: desktop keeps the fast WebRTC retry
instead of the `host_unavailable` wait for 10 minutes, and web tries again every 5 s for 3 minutes.
`host-restart-toast.ts` shows the notice until the host is back, for 10 minutes at most.

### Webhook routines

A webhook belongs to its routine. The host keeps the trigger, the encrypted secret, and receipts in
SQLite. D1 keeps only the route ID, the host, and the owner account.
Signal sends each signed request to the connected host without a cloud queue. All `events-v1`
routes need a host administrator. See [Webhook routines](events.md) and the
[webhook guide](../webhooks.md).

## Desktop server notifications

Each desktop profile stores muted server IDs in `servers.json`. `RemoteServerStore` saves a
mute change before publishing it. These preferences survive restart, re-login, and host-list
reconciliation. The server context menu controls mute for local and remote servers.

`renderer-forwarders.ts` continues to deliver live events for muted servers, but suppresses
system notifications. Remote notification content uses the source server's agent list. Both
server mute and per-agent notification settings apply. Unread state is unchanged. The iPhone app
has its own level and mute for each server, which the host applies to the notifications it sends to
that phone (see [iPhone notifications](channels-and-messaging.md#iphone-notifications)). Mute
settings are not synchronized between devices.

## Billing

Billing is per server. One account can pay for several servers; each server has its own Stripe
subscription. The Account Worker (`apps/auth-api/src/server/billing-service.ts`) talks to the Stripe
REST API with `fetch`; there is no Stripe SDK. The plan catalog in `packages/contracts/src/billing.ts`
holds the plan IDs, storage, member and site limits, relative speed and lookup keys, and no amounts. The amounts are six Stripe Prices with the lookup
keys `openbot_{plan}_{interval}`. `bun run api:stripe:bootstrap` (`scripts/stripe-bootstrap.ts`)
creates them and the Customer Portal settings.

- The add server dialog starts a plan. The hosting service
  (`apps/auth-api/src/server/hosted-billing.ts`) makes the Stripe customer before the Checkout, so
  two open Checkouts use one customer. The Checkout sets the subscription metadata
  `openbot_user_id` and `openbot_server_id` (`BILLING_METADATA`). The billing service calls the
  `onSubscriptionSynced` hook after each subscription sync; the hosting side uses it to provision,
  stop and resume servers, so billing does not know about boat. See
  [hosted servers](../hosted-servers.md#lifecycle). The webhook links a new Stripe customer to the
  account from `openbot_user_id`. It never moves a known
  customer to another account, and it skips a subscription that names no account.
- Desktop Settings → Billing and the web Billing dialog render `@openbot/ui/features/billing`: one
  row for each open plan, with the server name, the plan, its price, and its renewal controls.
  Hosted plans support cancellation that keeps data, Keep server, and explicit deletion now or
  after the paid period. A stored deletion date and subscription ID drive the cron; a fresh
  terminal Stripe state and a per-server operation lease guard deletion. See
  [server deletion](../hosted-servers.md#billing-and-server-deletion). The price is the list price of the Stripe Price in the subscription's currency (from
  `currency_options` when that is not the Price's base currency), before discounts and tax. The
  webhook stores it with the subscription. The
  account button opens the Customer Portal for the payment method and invoices.
- Desktop calls the `billing` IPC group; the main process gets a Customer Portal URL from the Worker,
  checks that it is a `billing.stripe.com` page, and opens it with `shell.openExternal`. The IPC takes
  no URL. The web client does the same check before `location.assign`. Checkout URLs get the same
  check for `checkout.stripe.com` (`isStripeCheckoutUrl`).
- The change and cancel actions open the Portal flow of one subscription. The Worker first checks
  that the subscription belongs to the account.
- The server name comes only from a `remote_hosts` row that the same account owns. A plan whose
  server was removed stays in the list, because Stripe bills it until the account cancels it.
- The webhook (`/v1/stripe/webhook`) checks the Stripe signature, records the event ID to ignore a
  repeat, and gets the subscription from Stripe again before it writes the D1 row. So the order of
  events has no effect.
- Without `STRIPE_SECRET_KEY` billing is off: the state is `available: false`, and the Portal route
  and the webhook answer 503.

Rule: plan limits read `getServerEntitlement` (`apps/auth-api/src/server/billing-entitlement.ts`)
only. It decides which statuses and grace periods give a server a plan, and it counts a plan only
for a server that the paying account owns. Do not read `billing_subscriptions` or a Stripe status in
another place.

## macOS Host Manager

`scripts/macos-tenant-setup.swift` is a separate administrator command for new Standard accounts.
It uses OpenDirectory directly, creates only new empty homes, and stores generated credentials
in a new root-only file before account creation. It is not installed or called by the daemon.
The Host PKG installs this as `create-tenants`, alongside the standalone `openbot-host` CLI.
`openbot-host-service.ts` owns setup/verification sequencing; `openbot-host-macos.ts` owns OS
operations. Passwords cross only the native helper's captured pipe and the administrator's tty,
not the host protocol. The root-only recovery file is removed after successful presentation.
`build-host-installer.ts` and `verify-host-installer.ts` own release packaging and the exact
payload manifest. Package installation preserves host registration and state; only the application
is automatically updated. A Host Manager upgrade requires an administrator-installed signed PKG.

The optional standalone root helper (`scripts/host-manager.ts`) uses the lifecycle in
`src/main/host-manager.ts` and fixed macOS operations in `scripts/host-manager-macos.ts`.
`src/main/host-update-coordinator.ts` is the unprivileged tenant client, not an update leader.
The local protocol types live in `packages/contracts/src/host-manager.ts`; bounded file parsing
and owner checks live in `src/main/host-update-files.ts`. Only the helper publishes host control
state or replaces the shared application. It has no dependency on tenant storage services.
The tenant process owns an in-memory activity generation in `src/backend/restart-activity.ts`.
Backend work and main-process sessions advance it, so work between status polls resets the idle
grace. This counter contains no user data and is never sent to the host. Health and restart
readiness remain false until agent initialization succeeds.
See [multi-tenant hosting](../multi-tenant-hosting.md) for installation, permissions, and acceptance.

## Hosted servers

A hosted server is one [boat](https://boat.dev) sandbox for one account. It runs the Linux
OpenBot build under Xvfb and is a normal Remote host after its first start. The account Worker
owns the sandbox lifecycle: it creates, resumes and deletes sandboxes, and D1 keeps the desired
and observed state. A server reports each minute while it is in use, and the Worker stops it after
15 minutes with no report. boat also stops each sandbox at the end of a 2-hour lease that activity
extends. When boat stops a server in use, the Worker resumes it, and clients ask the Worker to
start a stopped server when a connection fails. No message
waits in the Worker while a server is stopped; the client keeps it and connects again. The Worker's boat key cannot read files or run commands in a
sandbox. On a hosted server only, main reads the memory of the machine, and the backend holds new
turns while it is low and limits the turns that run at the same time. See
[hosted servers](../hosted-servers.md) for the flow, the configuration, the memory guards and the template.

A self-hosted server uses the same Linux build, scripts and units on the owner's own computer, with
`/opt/OpenBot/hosted/mode` set to `self`. It has no claim: main starts in server mode
(`src/main/server-mode.ts`, `OPENBOT_SERVER=1`), and the `openbot` terminal command signs it in over
a Unix socket in the 0700 runtime directory of the service user. Main publishes the host after each
sign-in. See [self-hosted servers](../self-hosted-server.md).

### Remote release checks

`host-release-v1` adds release status and check routes for all signed-in server members. It does not change
`host-update-v1`, which still refuses installation requests and checks when updates are managed
or disabled. The new check reads only the official stable release manifest for the host platform
and architecture. It never installs files, restarts the host, or changes update preferences.
The host checks that the manifest contains a compatible asset and returns only version, phase,
and installation method. Feed errors return a safe status and can be retried.
The method is `self-update` when the host's updater can install, also in a container of
`docker/instances`, whose host pulls the image on request
([Updates from the app](../docker.md#updates-from-the-app)). Other containers report `container`.

`HostReleaseService` owns release discovery. `RequestedUpdate` still owns idle restarts and
`UpdateService` still owns app updates. Desktop and web use the new capability when available;
older hosts keep their existing update controls. The status poll is passive and does not keep a
hosted server awake. Mobile shares the protocol codecs but has no new update screen.

`host-member-update-v1` adds `/v1/host/update/status`, `/check`, and `/start` for all active,
signed-in server members. It reuses the released update snapshot. The start body is empty:
requests always wait for idle time and preserve any existing schedule. Host restrictions still
apply. Cancellation, preferences, and forced restarts stay on the administrator-only
`host-update-v1` routes. Desktop and web clients show member controls only after this capability
is negotiated; older hosts keep the administrator-only panel.
