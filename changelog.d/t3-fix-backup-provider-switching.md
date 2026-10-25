### Fixed

- An agent set to switch to a backup model without asking now switches when its provider is overloaded or down. Before, it showed the error and stayed on the failing model for Claude's "529 Overloaded" errors, Codex's server, overload and retry-limit errors, Gemini's UNAVAILABLE status, and dropped connections.
