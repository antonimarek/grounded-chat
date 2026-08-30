# Grounded Chat — agent notes

Obsidian community plugin. TypeScript source in `src/`. esbuild writes `main.js` at repo root.

- Package manager: npm
- Plugin id: `grounded-chat` (must match the vault plugins folder name)
- Desktop only for now (`isDesktopOnly: true`)
- Do not commit `node_modules` or `data.json`
- `main.js` is gitignored. Publish it through GitHub Releases later
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
  settings.ts          # key, model, base URL
  openrouter/client.ts # streaming chat
  view/ChatView.ts     # sidebar chat UI
```

Later: `src/index/`, `src/retrieve/`, `src/prompt/`.
