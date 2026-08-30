# Grounded Chat

Obsidian plugin. You ask questions about your notes. Answers use retrieved notes and list sources.

The plugin uses your OpenRouter API key. There is no paywall and no extra vendor cloud.

Status: Phase 2. Local lexical index, graph expand, and citation links.

See [ROADMAP.md](ROADMAP.md).

## Requirements

- Obsidian desktop
- Node.js LTS (for development)
- An OpenRouter API key

## Use

1. Enable the plugin.
2. Set the API key and model in settings.
3. Open chat from the ribbon or the command palette.
4. Wait until the banner shows file and chunk counts.
5. Ask a question. Sources appear under the answer. Click a source to open the note.
6. Use Stop to cancel a stream.
7. Optional: command **Rebuild index** after you change exclude folders.

## Check it in Obsidian

1. Reload Obsidian (`Cmd+R`).
2. Enable **Grounded Chat**.
3. Set an API key.
4. Open chat. Banner should show file and chunk counts, not "retrieval is off".
5. Ask about a note you know exists. Pass: answer cites that note and the evidence link opens it.

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

- Chat sends the question, retrieved chunks, and conversation messages to OpenRouter.
- The index stays on the device (IndexedDB). It does not sync with the vault.
- Keep `data.json` small. Do not store the index there.

Do not commit machine-specific paths, vault names, or API keys.

## License

MIT. See [LICENSE](LICENSE).
