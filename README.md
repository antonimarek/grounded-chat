# Vault Chat

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

## Develop

Clone this repository outside your vault (and outside cloud-synced folders if you can). Obsidian loads the plugin through a symlink.

1. Install dependencies.

```bash
cd /path/to/vault-chat
npm install
```

2. Link the plugin into your vault (once). Replace the paths with your own.

```bash
ln -sfn /path/to/vault-chat \
  /path/to/YourVault/.obsidian/plugins/vault-chat
```

3. Build once, then watch.

```bash
npm run build
npm run dev
```

4. In Obsidian, turn off Restricted mode. Enable **Vault Chat**.
5. Optional: install the community plugin **Hot Reload**. This repo includes an empty `.hotreload` file.

Do not copy `node_modules` into the vault. Keep the git repo outside cloud sync when possible.

## Privacy

- Chat sends the question and conversation messages to OpenRouter.
- The future index will stay on the device (IndexedDB). It will not sync with the vault.
- Keep `data.json` small. Do not store the index there.

Do not commit machine-specific paths, vault names, or API keys.

## License

MIT. See [LICENSE](LICENSE).
