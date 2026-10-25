### Added

- The steps row above an agent's answer now opens a trace of the turn. Each thought, tool call and
  subagent is a bar on one timeline, with the duration, cost and tokens of the turn. You can search
  the steps with ⌘F (Ctrl+F), fold an agent's steps, replay the turn at up to 10× speed, and move
  between the rows with the arrow keys. A click on a step shows it in the chat.
- The steps row now looks like the subagents header above it. It shows the time of the turn and how
  many steps failed.

### Fixed

- The first Claude turn after OpenBot starts again now has a cost in Analytics and in the turn trace.
  OpenBot estimates it from Anthropic's list prices, because Claude does not report the cost of that
  turn.
