# Grounded Chat

Obsidian plugin. You ask questions about your notes. Later phases will answer from retrieved notes and show sources as wikilinks.

The plugin uses your OpenRouter API key. There is no paywall and no extra vendor cloud.

Status: Phase 1. Sidebar chat streams from OpenRouter. Retrieval is not on yet.

See [ROADMAP.md](ROADMAP.md).

## Requirements

- Obsidian desktop
- Node.js LTS (for development)
- An OpenRouter API key

## Use

1. Enable the plugin.
2. Set the API key and model in settings.
3. Open chat from the ribbon or the command palette.
4. Ask a question. Use Stop to cancel a stream.

A banner reminds you that answers do not use vault notes until retrieval ships.

## Check it in Obsidian

1. Reload Obsidian (`Cmd+R` on desktop, or quit and reopen).
2. Settings → Community plugins → Restricted mode off.
3. Confirm **Grounded Chat** is in the installed list and enabled.
4. Settings → Grounded Chat → paste an OpenRouter key. Set a model slug.
5. Command palette (`Cmd+P`) → **Grounded Chat: Open chat**.
6. You should see a right sidebar titled **Chat** and a banner that retrieval is off.
7. Type `Reply with the single word ok` and press Enter.
8. Pass: tokens stream in. Fail: empty state, error line, or no sidebar.

If the plugin is missing: the folder `.obsidian/plugins/grounded-chat` must contain `manifest.json` and `main.js` (or a symlink to the repo). Then reload again.

## Develop

Clone this repository outside your vault (and outside cloud-synced folders if you can). Obsidian loads the plugin through a symlink.

1. Install dependencies.

```bash
cd /path/to/grounded-chat
npm install
```

2. Link the plugin into your vault (once). Replace the paths with your own.

```bash
ln -sfn /path/to/grounded-chat \
  /path/to/YourVault/.obsidian/plugins/grounded-chat
```

3. Build once, then watch.

```bash
npm run build
npm run dev
```

4. In Obsidian, turn off Restricted mode. Enable **Grounded Chat**.
5. Optional: install the community plugin **Hot Reload**. This repo includes an empty `.hotreload` file.

Do not copy `node_modules` into the vault. Keep the git repo outside cloud sync when possible.

## Privacy

- Chat sends the question and conversation messages to OpenRouter.
- The future index will stay on the device (IndexedDB). It will not sync with the vault.
- Keep `data.json` small. Do not store the index there.

Do not commit machine-specific paths, vault names, or API keys.

## License

MIT. See [LICENSE](LICENSE).
