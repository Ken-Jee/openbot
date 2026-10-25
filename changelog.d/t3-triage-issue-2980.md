### Fixed

- When a Grok turn fails after it used tokens, the error now shows the reason that Grok gives, such as `empty response from model (reasoning_only)`, and not only `Internal error`. The routine run history keeps the same reason (#2980).
