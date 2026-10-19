### Added

- One OpenBot server can connect more than one Slack workspace or Discord server. Settings › Connectors shows "Add workspace" or "Add Discord server" after the first one is set up. One Slack Orchestrator answers every Slack workspace, and one Discord Orchestrator answers every Discord server, as one Telegram Orchestrator already answers every Telegram chat.
- You can choose which Discord roles can use OpenBot in each Discord server. OpenBot ignores a mention from a member who has none of the roles. With no role chosen, everyone can mention OpenBot, as before.

### Fixed

- When you mention OpenBot in a Discord reply to someone else's message, OpenBot now reads the message you replied to. Before, OpenBot said that it could not see what "this" was.
