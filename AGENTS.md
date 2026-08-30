# Grounded Chat — agent notes

Obsidian community plugin. TypeScript source in `src/`. esbuild writes `main.js` at repo root.

- Package manager: npm
- Plugin id: `grounded-chat` (must match the vault plugins folder name)
- Desktop only for now (`isDesktopOnly: true`)
- Do not commit `node_modules` or `data.json`
- `main.js` is gitignored. Publish it through GitHub Releases (see [CONTRIBUTING.md](CONTRIBUTING.md))
- Product rules: [ROADMAP.md](ROADMAP.md). Do not invent knowledge that is not in retrieved notes.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Layout

```
src/
  main.ts              # lifecycle
  settings.ts          # key, model, base URL, topK, excludes
  chat/                # planner, epistemic status, save-answer
  openrouter/          # streaming chat, tool routing
  view/ChatView.ts     # sidebar chat UI
  index/               # chunker, MiniSearch, IndexedDB, vault watch
  retrieve/            # lexical retriever, query tuning
  prompt/builder.ts
```

Contributing and releases: [CONTRIBUTING.md](CONTRIBUTING.md).

