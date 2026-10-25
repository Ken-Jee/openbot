### Added

- Grok agents can now be steered. A message that you send in Steer mode while a Grok agent works
  goes into the running turn, and Grok reads it after its current step. Before, the message waited
  in the queue until the turn ended. A Grok CLI without this feature keeps the message in the queue.
