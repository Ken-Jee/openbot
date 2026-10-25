### Changed

- Agents now follow your user-level `CLAUDE.md` or `AGENTS.md`, and the one at the root of the agent
  workspace, when these files set the persona, reply length and format, delegation, or group-chat
  behavior. Before, OpenBot's built-in style guidance and your files gave the agent two rule sets for
  the same decision. Files in cloned repositories do not get this priority. The rules for tools,
  memory, approvals, secrets, private details, safety checks and the browser do not change.
