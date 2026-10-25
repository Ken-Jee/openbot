### Added

- The Claude page in Server settings › Providers has a "Prompt cache" setting: 1 hour or 5 minutes.
  An owner or admin can set it for this computer and for a joined server.

### Changed

- Claude agents now keep the prompt cache for 1 hour by default, also with an Anthropic API key,
  for subagents, and on a subscription that uses extra usage. Before, these used 5 minutes, so a
  turn that started later sent the full context again at the full price. A 1-hour cache write costs
  more than a 5-minute write; choose "5 minutes" to go back to Claude Code's own choice. A `promptCacheTtl` in the Claude settings, or
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, still sets the time.
