# Roadmap

Shipped work stays in git history. This file holds work that is **not** in the current MVP.

Use GitHub Issues for new ideas. Labels: `mvp`, `phase-2`, `phase-3`, `ux`, `retrieval`.

## Now (MVP)

- Phase 0: plugin loads, settings for key and model, ribbon and command. Done.
- Phase 1: OpenRouter streaming chat shell (no retrieval). Done.
- Phase 2: local lexical index (MiniSearch), citations, graph expand. Done.
- Phase 3: epistemic status (`GROUNDED` / `PARTIAL` / `UNCERTAIN`), folder excludes, save-answer command.
- Phase 4: OSS docs, release CI.

## Later (not in MVP)

- Opt-in embeddings via OpenRouter (`qwen/qwen3-embedding-*` or similar).
- Hybrid lexical + vector retrieval.
- Privacy toggle: lexical only, no embed API.
- Mobile support (`isDesktopOnly: false`).
- Chat history as vault notes (syncs with iCloud).
- Local models (Ollama).
- Rerankers.
- Multi-agent tools and web search.
- Auto-rewrite or enrich notes (out of product intent unless explicit later).
- Community Plugin directory submission.
- Cloud sync of the index (avoid; rebuild per device).

## Product rules that stay

- Do not invent facts that are not in retrieved notes.
- Show evidence before polish.
- Do not write notes unless the user runs an explicit command.
- Keep settings few and named in plain language.
- No paywall.
