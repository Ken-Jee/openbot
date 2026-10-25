### Fixed

- The agent usage page now counts all Gemini tokens. Antigravity 1.4.3 sends the tokens of each
  turn, but OpenBot added them as a session total, so a turn smaller than an earlier turn in the
  same session counted as 0. Gemini thinking tokens now also count as output. Usage that was
  recorded before this fix does not change.
