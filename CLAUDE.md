
## Language
Unless asked otherwise, use simple language. Follow ASD-STE100, but extend the vocabulary with domain terms.

## Subagents
Give work to subagents (Agent tool) where it fits. Always set `model`:
- `sonnet`: mechanical work with clear instructions. Examples: tasks from a tasks.md, scaffolding, renames, doc updates, test fixtures, file searches.
- `opus`: research and architecture. Examples: compare options, read external docs and APIs, design.md decisions, spike analysis, reviews.
Do it yourself: small work (a few tool calls), integration across packages, the final check of each subagent result.
Brief each subagent fully: goal, files, rules, done criteria. Independent subagents run in parallel.

## Project
md-coeditor: Word-like track changes (CriticMarkup) in Obsidian + interactive Claude Code session in a terminal. CLI binary: `coedit`.
Status: see openspec/docs/roadmap.md. Scope: Claude Code only; Codex deferred (no access), keep design agent-neutral.
Docs: openspec/docs/{vision,roadmap,architecture,tech-stack,testing,install,windows-check-list}.md (vision = purpose and value, no tech; roadmap = slices, changes, status). architecture.md is the entry point; details in architecture-{obsidian,claude,format}.md. openspec/docs/initial-plan.md: frozen, partly old; other docs win on conflict.

## Stack
- pnpm 12 workspaces (`packageManager` pnpm@12.15.0, `catalog:` for shared versions); no Turbo/Nx. TypeScript strict, ESM. Node >=24.15 for dev (jsdom 30), >=24 for `coedit` runtime. No Bun.
- esbuild bundles; `tsc --noEmit` for types.
  - plugin: cjs, es2022, external obsidian, electron, @codemirror/*, @lezer/*; bundle `ws`.
  - bridge: one-file ESM `dist/coedit.mjs`, shebang + createRequire banner, fs.chmod on macOS/Linux; copy to adapters/claude/dist/.
- Internal pkgs: `private`, `exports: ./src/index.ts`, no build step. moduleResolution bundler.
- @modelcontextprotocol/sdk (stdio). zod. Bridge runtime uses Node global WebSocket; `ws` is only a bridge devDependency (test fake hubs). CLI args: node:util parseArgs.
- vitest; jsdom for CM6 tests; @codemirror/* versions = Obsidian's (devDeps only). Biome.
- E2E: `pnpm test:e2e:docker` (Linux in Docker, no window) and `pnpm test:e2e` (macOS, opens windows). Not in `check`. See Testing.
- Root scripts: build, dev, test, typecheck, lint, format, check (= lint+typecheck+test), link:bin (coedit on PATH). Test vault: `coedit init --dev` in test-vault/.

## Layout
- packages/format: markup parse/ops/accept/reject/rebase. No Obsidian, no CodeMirror.
- packages/protocol: hub<->bridge messages, log events (zod).
- packages/obsidian: plugin; CM6 ext, hub (WS 127.0.0.1, random port, token), log writer. isDesktopOnly.
- packages/bridge: `coedit` = mcp | inbox | claude | init.
- packages/e2e: end-to-end tests in real Obsidian (wdio 9 + mocha + wdio-obsidian-service); fixture vault packages/e2e/vault. See openspec/docs/testing.md.
- adapters/claude: Claude Code plugin (.mcp.json, hooks, agents/co-editor.md); self-contained (dist/coedit.mjs); no bin/ dir, no guard hook.
- spikes/: throwaway (S1 live tracking, S2 channels). test-vault/: manual tests.

## Testing
Full rules: openspec/docs/testing.md. For agents that write tests:
- Two levels: vitest (`pnpm test`, in `check`) and e2e in real Obsidian (`packages/e2e`, wdio + mocha). Write both where they fit.
- Plugin behaviour that needs the real app (cursor and keys over hidden syntax, menus, palette, notices, Reading view, Source mode, files on disk, hover): write an e2e test in `packages/e2e/tests/*.e2e.ts`. This is the strong default, not optional. In the vitest spec file, keep a `test.todo("<scenario>: e2e in packages/e2e/tests/<file>.e2e.ts")`.
- Names: `describe` = capability, `it` = scenario name exactly as in the spec.
- Use the helpers in `packages/e2e/helpers` (`openNote`, `at`, `setCursor`, `docText`, `fileText`, `rightClickOn`, `menuItems`, `paletteItems`, `waitForNotice`, `tooltipOf`, `writeOnDisk`, `startBridge`/`runInbox` in `bridge.ts` = scripted MCP client and inbox hook against `dist/coedit.mjs`, no real `claude`). `modKey()` for Cmd/Ctrl. No `pause()`: wait for conditions. Fixture notes in `packages/e2e/vault/`, one per area; `vault/agent/` for agent tests (hub, tools, log, loop). Tests in `adapters/*/test/**` run in vitest.
- Run: `pnpm test:e2e:docker` (Linux, no window; use this as an agent). `pnpm test:e2e` (macOS) opens windows that take the keyboard focus; run it only when asked or before an archive.
- New e2e test: check it once by breaking the plugin on purpose (it must fail), then undo the break.

## Rules
- Spec first: work through OpenSpec changes (openspec/changes/). No code without a change.
- Hub is the only network server. Bridge = stdio MCP server, client of hub. Tool logic that changes notes is in the hub; the bridge reads the log, builds the digest and writes cursors.
- One writer per file: the plugin (hub, editor) writes notes, log, endpoint.json, local/.gitignore. Bridge/inbox write only cursors (.coedit/local/<machine>/cursors/<session>.json). Machine-local state lives in .coedit/local/<machine>/.
- Every agent interaction is triggered by the user. Agent is suggest-only (soft: tool descriptions, optional profile). No guard hook; hard blocks come from the project's Claude Code permissions (`coedit init` shows a deny rule; scripts are not blocked).
- Claude plugin `defaultEnabled: false`. Only `coedit claude` enables it, per session, via `--settings` enabledPlugins. Never user/project scope.
- Marks and comments stay inline in notes (committed). `.coedit/` git: commit config.json, style.md; ignore local/, snapshots/, *.sock, *.lock (via .coedit/.gitignore; the plugin also writes local/.gitignore = `*`).
- Frontmatter, code blocks, tables: never tracked, never suggested into.
- Desktop only. Must work on macOS and Windows (Linux: should work, not tested): Node scripts only (no shell commands), node:path for paths, no shebang/symlink reliance on Windows.
