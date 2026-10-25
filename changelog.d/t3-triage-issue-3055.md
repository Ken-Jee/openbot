### Added

- The usage list shows each Gemini limit on its own line, such as Gemini Models, Gemini 4 Argon, and
  Claude and GPT models. The warning above the message box uses the limit of the agent's model.

### Fixed

- Gemini usage now follows the limit of the model that an agent uses. Google can give a model, such
  as Gemini 4 Argon, a weekly limit of its own. Before, OpenBot put all Gemini limits together, so a
  spent Argon limit could show for Gemini 3.8 Flash, or Argon could show room that it did not have.
