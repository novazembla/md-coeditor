
## Language
Unless asked otherwise, use simple language. Follow ASD-STE100, but extend the vocabulary with domain terms.

## Project
md-coeditor: Word-like track changes (CriticMarkup) in Obsidian + interactive Claude Code session in a terminal. CLI binary: `coedit`.
Status: monorepo skeleton only (setup-monorepo); no product features yet. Scope: Claude Code only; Codex deferred (no access), keep design agent-neutral.
Docs: openspec/docs/{architecture,tech-stack,install}.md. Plan: ~/.claude/plans/zany-petting-starfish.md (older; docs win on conflict).

## Stack
- pnpm 12 workspaces (`packageManager` pnpm@12.15.0, `catalog:` for shared versions); no Turbo/Nx. TypeScript strict, ESM. Node >=24.15 for dev (jsdom 30), >=24 for `coedit` runtime. No Bun.
- esbuild bundles; `tsc --noEmit` for types.
  - plugin: cjs, es2022, external obsidian, electron, @codemirror/*, @lezer/*; bundle `ws`.
  - bridge: one-file ESM `dist/coedit.mjs`, shebang + createRequire banner, fs.chmod on macOS/Linux; copy to adapters/claude/dist/.
- Internal pkgs: `private`, `exports: ./src/index.ts`, no build step. moduleResolution bundler.
- @modelcontextprotocol/sdk (stdio). zod. Bridge uses Node global WebSocket (no `ws`). CLI args: node:util parseArgs.
- vitest; jsdom for CM6 tests; @codemirror/* versions = Obsidian's (devDeps only). Biome.
- Root scripts: build, dev, test, typecheck, lint, format, check (= lint+typecheck+test), link:bin (coedit on PATH), link:vault (temp, until `coedit init --dev`).

## Layout
- packages/format: markup parse/ops/accept/reject/rebase. No Obsidian, no CodeMirror.
- packages/protocol: hub<->bridge messages, log events (zod).
- packages/obsidian: plugin; CM6 ext, hub (WS 127.0.0.1, random port, token), log writer. isDesktopOnly.
- packages/bridge: `coedit` = mcp | inbox | claude | init.
- adapters/claude: Claude Code plugin; self-contained (dist/coedit.mjs); no bin/ dir.
- spikes/: throwaway (S1 live tracking, S2 channels). test-vault/: manual tests.

## Rules
- Spec first: work through OpenSpec changes (openspec/changes/). No code without a change.
- Hub is the only network server. Bridge = stdio MCP server, client of hub, thin in slice 1 (logic in hub).
- One writer per file: hub writes notes, log, endpoint.json. Bridge/inbox write cursor.json only.
- Every agent interaction is triggered by the user. Agent is suggest-only; guard blocks Edit/Write on attached notes.
- Claude plugin `defaultEnabled: false`. Only `coedit claude` enables it, per session, via `--settings` enabledPlugins. Never user/project scope.
- Marks and comments stay inline in notes (committed). `.coedit/` git: commit config.json, style.md; ignore endpoint.json, cursor.json, log/, snapshots/, *.sock, *.lock (via .coedit/.gitignore).
- Frontmatter, code blocks, tables: never tracked, never suggested into.
- Desktop only. Must work on macOS and Windows (Linux: should work, not tested): Node scripts only (no shell commands), node:path for paths, no shebang/symlink reliance on Windows.
