---
name: kitten-cli
type: tool-guidance
target_tool: Bash
priority: 5
token_cost: 100
user-invocable: false
---

## Kitten CLI
Kitten is a web framework. Its CLI is the `kitten` binary.

COMMANDS:
- `kitten` — start dev server (https://localhost, hot-reload enabled)
- `kitten update` — update Kitten itself
- `kitten db` — database commands
- `kitten deploy` — deploy commands

INSTALL (one-time, if not already installed):
  curl -sL https://kittens.small-web.org/install | bash

On macOS, the installer may prompt to add `~/.local/bin` to PATH.

EXAMPLE WORKFLOW:
  1. Create project dir: `mkdir my-app && cd my-app`
  2. Create `index.page.js` with a default export returning `kitten.html`...
  3. Run: `kitten`
  4. Visit: https://localhost

Use timeout=120 for `kitten update`. Use `kitten &` for kitten (server will block execution otherwise). Make sure you note its process ID and kill it once you’re done.
