# Proposal

## Why

The repo has docs and no code. Before slice 1 (the agent suggests, the user accepts or rejects) can start, we need a working monorepo: packages, builds, tests, lint, and a `coedit` binary that is on the PATH. All of it must work on macOS and on Windows. If we set this up first, every later change only adds features and does not fight tooling.

## What Changes

- Add a pnpm workspace at the repo root with shared TypeScript, Biome and vitest settings, as described in `openspec/docs/tech-stack.md`.
- Add the internal packages `packages/format` and `packages/protocol`. They are empty: an entry file only, no product code.
- Add `packages/obsidian`: an Obsidian plugin skeleton (id `md-coeditor`, desktop only) that builds to `dist/` and loads in Obsidian without errors. It has no features.
- Add `packages/bridge`: the `coedit` binary skeleton. One bundled file with a shebang line. It supports `--version` and `--help`, and rejects unknown subcommands. The subcommands `mcp`, `inbox`, `claude` and `init` come in later changes.
- Add `adapters/claude`: a Claude Code plugin skeleton (`plugin.json` with `defaultEnabled: false`, plus its own copy of `coedit.mjs`), and a local marketplace file at `.claude-plugin/marketplace.json`.
- Add `spikes/` (empty, with a short README) and `test-vault/` (a small Obsidian vault for manual tests).
- Add root scripts: `build`, `dev`, `test`, `typecheck`, `lint`, `format`, `check`, and two temporary link scripts: `link:bin` (puts `coedit` on the PATH) and `link:vault` (links the plugin into the test vault).
- Add a root `.gitignore` and a `.gitattributes` (LF line endings on all systems).
- Update the docs (`openspec/docs/*.md`, `README.md`, `CLAUDE.md`): pnpm 12 replaces pnpm 10, `pnpm link:bin` replaces `pnpm link --global` (pnpm 11 removed it), the bundle is `coedit.mjs`, Windows is a supported OS next to macOS, and install.md shows which steps work after this change.

Not in this change: markup parsing, the hub, MCP tools, hooks, `coedit init`, `coedit claude`, CI, the npm package.

## Capabilities

### New Capabilities

- `coedit-cli`: the `coedit` command-line binary. This change covers how it starts, shows its version and help, and reports unknown subcommands. Later changes add the subcommands `init`, `claude`, `inbox` and `mcp` to this capability.

### Modified Capabilities

None. There are no specs yet.

## Impact

- New files at the repo root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`, `.node-version`, `.claude-plugin/marketplace.json`.
- New folders: `packages/{format,protocol,obsidian,bridge}`, `adapters/claude`, `spikes`, `test-vault`, `scripts`.
- New dev dependencies: TypeScript, esbuild, vitest, jsdom, Biome, `obsidian` (types), `@codemirror/state` and `@codemirror/view` (tests only), `@types/node`. No runtime dependencies yet. `ws`, `zod` and `@modelcontextprotocol/sdk` come with the change that first uses them.
- Developer machine (macOS or Windows): Node 24.15 or newer, and pnpm 12. `pnpm link:bin` puts `coedit` on the PATH: a symlink in `~/.local/bin` on macOS, a `coedit.cmd` file in `%LOCALAPPDATA%\md-coeditor\bin` on Windows.
