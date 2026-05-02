# opencode-recap

An [OpenCode](https://opencode.ai) TUI plugin that generates a concise AI summary of your current session and displays it in the sidebar.

- Click **Recap** in the sidebar to trigger a summary
- Output renders as Markdown, styled with your active theme
- Summary appears in the sidebar — not in the chat thread
- Recap auto-clears after 3 new prompts so it doesn't go stale

## Installation

This is a **TUI plugin** and must be installed via `tui.json`, not `opencode.json`.

### From GitHub (no npm publish required)

**1.** Clone or download `index.ts` into your OpenCode plugins directory:

```sh
mkdir -p ~/.config/opencode/plugins
curl -o ~/.config/opencode/plugins/recap.ts \
  https://raw.githubusercontent.com/streetturtle/opencode-recap/main/index.ts
```

**2.** Add the dependencies to `~/.config/opencode/package.json` (create it if it doesn't exist):

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.4.3",
    "@opentui/core": "*",
    "@opentui/solid": "^0.1.100",
    "solid-js": "^1.9.9"
  }
}
```

**3.** Register the plugin in `~/.config/opencode/tui.json` (create it if it doesn't exist):

```json
{
  "plugin": ["./plugins/recap.ts"]
}
```

**4.** Install dependencies. OpenCode bundles its own Bun — run:

```sh
BUN_BE_BUN=1 /opt/homebrew/bin/opencode install
```

> Adjust the path to `opencode` if you installed it elsewhere (`which opencode`).

**5.** Restart OpenCode. The **Recap** button will appear in the sidebar.

## Usage

Open a session, have a conversation, then click **Recap** in the sidebar. The summary updates in place each time you click it.

The plugin summarizes only recent context (last 10 messages) and includes your previous recap as context to keep continuity.

The recap follows this structure:

- **Working on** — one sentence on current focus
- **Done** — up to 2 short bullets
- **Next** — immediate next step (if any)

## Requirements

- OpenCode 1.4.3+
- Any AI provider configured in OpenCode
