# Contributing

Thanks for helping improve Grounded Chat.

## Before you start

- Read [ROADMAP.md](ROADMAP.md) for scope. Do not add features that are explicitly deferred unless you discuss them first.
- Product rule: do not invent facts that are not in retrieved notes.
- Keep settings few and named in plain language.

## Development setup

1. Clone the repo outside your vault (and outside cloud-synced folders when possible).
2. Install dependencies: `npm install`
3. Symlink into your vault:

```bash
ln -sfn /path/to/grounded-chat \
  /path/to/YourVault/.obsidian/plugins/grounded-chat
```

4. Build and watch:

```bash
npm run build
npm run dev
```

5. In Obsidian: turn off Restricted mode, enable **Grounded Chat**, reload after changes (`Cmd+R` / `Ctrl+R`).

Optional: install the community plugin **Hot Reload**. This repo includes an empty `.hotreload` file.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Watch build to `main.js` |
| `npm run build` | Typecheck + production bundle |
| `npm run lint` | ESLint |

Run `npm run build` and `npm run lint` before opening a pull request.

## Pull requests

1. Open an issue first for large changes (new retrieval modes, settings, UI flows).
2. Keep diffs focused. Match existing TypeScript style and file layout.
3. Do not commit `node_modules`, `data.json`, `main.js`, or machine-specific paths.
4. Update [README.md](README.md) when user-facing behavior changes.

CI runs on every push and pull request (build + lint on Node 20, 22, 24).

## Project layout

See [AGENTS.md](AGENTS.md) for a short map of `src/`.

## Releases (maintainers)

Releases are built by GitHub Actions when a version tag is pushed.

1. Ensure `main` is clean and CI is green.
2. Bump version (updates `manifest.json` and `versions.json`):

```bash
npm version patch   # or minor / major
```

3. Push commit and tag:

```bash
git push origin main --tags
```

4. Open the draft release on GitHub. Check attached assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `versions.json`
5. Edit release notes if needed, then publish the release (remove draft).

Users install from release assets. See [README.md](README.md#install-from-github-release).

## Issue labels

Use labels from [ROADMAP.md](ROADMAP.md): `mvp`, `phase-2`, `phase-3`, `ux`, `retrieval`.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
