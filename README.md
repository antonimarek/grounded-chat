# Grounded Chat

[![CI](https://github.com/antonimarek/grounded-chat/actions/workflows/lint.yml/badge.svg)](https://github.com/antonimarek/grounded-chat/actions/workflows/lint.yml)

Obsidian plugin. You ask questions about your notes. Answers use retrieved notes and list sources.

The plugin uses your OpenRouter API key. There is no paywall and no extra vendor cloud.

See [ROADMAP.md](ROADMAP.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- Obsidian desktop (1.8.0+)
- An OpenRouter API key

Node.js is only required for development or building from source.

## Install from GitHub release

1. Open [Releases](https://github.com/antonimarek/grounded-chat/releases).
2. Download the latest release assets: `main.js`, `manifest.json`, `styles.css`.
3. Create a folder in your vault:

```
YourVault/.obsidian/plugins/grounded-chat/
```

4. Copy the three files into that folder.
5. Reload Obsidian (`Cmd+R` / `Ctrl+R`).
6. Settings → Community plugins → turn off Restricted mode → enable **Grounded Chat**.
7. Settings → **Grounded Chat** → set your API key and model.

The plugin is not in the Obsidian Community Plugin directory yet. Install manually from releases for now.

## Use

1. Open chat from the ribbon or command palette (**Open chat**).
2. Wait until the banner shows file and chunk counts.
3. Ask a question. Sources appear under the answer. Click a source to open the note.
4. Status badge on vault answers: **GROUNDED**, **PARTIAL**, or **UNCERTAIN**.
5. Use **Stop** to cancel a stream.
6. Optional: **Save last answer to note** command or the download icon on a reply.
7. Optional: enable **Persist chat** in settings to keep the thread after reload.
8. Optional: pick a **Skill** from the dropdown (loads `SKILL.md` files from `.cursor/skills/` in your vault).
9. Token usage shows per reply (↓ prompt · ↑ completion) and session total at the bottom when enabled in settings.
10. Optional: command **Rebuild index** after you change exclude paths or update the plugin (search tokenization may change).
9. Optional: command **Clear chat** to reset the thread.

## Check it in Obsidian

1. Reload Obsidian.
2. Enable **Grounded Chat** and set an API key.
3. Open chat. Banner should show file and chunk counts.
4. Ask about a note you know exists. Pass: answer cites that note and the evidence link opens it.
5. Ask a follow-up about the conversation ("what did I ask?"). Pass: no new vault search, label shows **From conversation**.

## Develop

Clone this repository outside your vault. Obsidian loads the plugin through a symlink.

```bash
git clone https://github.com/antonimarek/grounded-chat.git
cd grounded-chat
npm install
```

Link into your vault (once):

```bash
ln -sfn /path/to/grounded-chat \
  /path/to/YourVault/.obsidian/plugins/grounded-chat
```

Build and watch:

```bash
npm run build
npm run dev
```

In Obsidian: turn off Restricted mode, enable **Grounded Chat**, reload after changes.

Do not copy `node_modules` into the vault. Keep the git repo outside cloud sync when possible.

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull requests and releases.

## Skills

Place skills in your vault under `.cursor/skills/<skill-id>/SKILL.md` (folder configurable in settings). Each skill needs YAML frontmatter with `name` and `description`. Select a skill in the chat pane dropdown, or type `/skill-id/` in the input (Cursor-style). Autocomplete appears when you type `/`.

Examples:
- `/conversation-to-obsidian-note/` — activate skill (auto-attaches the open editor note)
- `/conversation-to-obsidian-note/ re-gist this note` — with a message
- `[[My Note]] summarize the gist` — attach a note inline for one message
- **Attach active note** button — pin the editor note to the chat

Attached note content is sent to the model as the primary source. Vault search still runs when the skill or question needs related links.

## Privacy

- Chat sends the question, retrieved chunks, and conversation messages to OpenRouter.
- The index stays on the device (IndexedDB). It does not sync with the vault.
- Optional chat persistence stores the thread in plugin `data.json` on this device only.
- Keep `data.json` small. Do not store the index there.

Do not commit machine-specific paths, vault names, or API keys.

## License

MIT. See [LICENSE](LICENSE).
