# MD-Coeditor

MD-Coeditor gives you Word-like track changes for Markdown notes in Obsidian. An AI agent (Claude Code) runs in a separate terminal and suggests changes. Each suggestion shows in the note as a tracked change. You accept or reject it in Obsidian, and the agent sees your decisions the next time it runs. The command-line tool is `coedit`.

Status: the suggest loop works (change `add-claude-suggest-loop`): the agent suggests changes in Obsidian, and the next prompt gets your decisions. Checks with a real `claude` login are open. Scope: Claude Code only. Codex comes later.

MD-Coeditor is an [OpenSpec](https://openspec.dev/) project. We write the specs first. Then we write the code that meets the specs.

## Documentation

| Document | Contents |
| --- | --- |
| [Vision](openspec/docs/vision.md) | Why the product exists, for whom, its value |
| [Roadmap](openspec/docs/roadmap.md) | Slices, changes, order, status |
| [Architecture](openspec/docs/architecture.md) | Entry point: components, diagrams, vault files and git, rules. Details: [Obsidian side](openspec/docs/architecture-obsidian.md), [Claude side](openspec/docs/architecture-claude.md), [mark format](openspec/docs/architecture-format.md) |
| [Tech stack](openspec/docs/tech-stack.md) | Tools, packages, builds, Claude plugin, corporate setting |
| [Install](openspec/docs/install.md) | Development install: build, `pnpm link:bin`, test vault, `coedit init`, `coedit claude` |
| [Testing](openspec/docs/testing.md) | Test levels, e2e tests in Obsidian, manual checks |
| [Windows check list](openspec/docs/windows-check-list.md) | Open checks. Windows is not tested yet |

## Components

- **Obsidian plugin**: shows the tracked changes, lets you accept and reject them, and runs the hub. The hub is a local WebSocket server.
- **`coedit` binary**: a bridge between Claude Code and the hub (`coedit mcp`), the digest for the hook (`coedit inbox`), the launcher (`coedit claude`), and the vault setup (`coedit init`).
- **Claude Code plugin**: the agent definition, the hooks and the MCP config. It loads only in sessions that `coedit claude` starts.

## Tech stack

- pnpm 12 workspaces (with a `catalog:` for shared versions), TypeScript (strict, ESM)
- Node 24.15 or newer for development, Node 24 or newer for `coedit`
- esbuild for the bundles, `tsc --noEmit` for type checks
- `@modelcontextprotocol/sdk` (stdio), zod, `ws` (in the Obsidian plugin only)
- vitest (with jsdom for the CodeMirror tests), Biome

Shared code (`packages/format`, `packages/protocol`) is in internal packages. The other packages import them as TypeScript source. For details, see [tech-stack.md](openspec/docs/tech-stack.md).

## Repo layout

```
packages/format     markup: parse, accept, reject. No Obsidian code.
packages/protocol   messages between hub and bridge, log events
packages/obsidian   the Obsidian plugin
packages/bridge     the coedit binary
adapters/claude     the Claude Code plugin
spikes/             throwaway experiments
test-vault/         Obsidian vault for manual tests
openspec/           specs, changes and docs
```

## Install (development)

Requirements: macOS or Windows (Linux should work, but it is not tested), Node 24.15 or newer, pnpm 12, Obsidian, Claude Code.

```sh
pnpm install
pnpm build
pnpm link:bin                          # puts coedit on your PATH
coedit --version
(cd test-vault && coedit init --dev)   # links the Obsidian plugin into test-vault/, prepares .coedit/
```

Then open `test-vault/` in Obsidian and start a session in the repo:

```sh
coedit claude                  # finds the vault; the plugin is on for this session only
coedit claude --vault test-vault --agent -- --continue
```

`--vault <path>` picks the vault. `--agent` starts the co-editor profile.

Everything after `--` goes to `claude` unchanged, so you can use any `claude` option:

```sh
coedit claude -- --continue              # continue the last conversation
coedit claude -- --resume                # pick a conversation to resume
coedit claude -- --model sonnet          # choose the model
coedit claude -- --permission-mode plan  # start in plan mode
```

Each `coedit claude` run is a new co-editor session, also with `--continue` or `--resume`. The digest lists only the decisions that you make while the session runs. Decisions from before the start stay in the notes (and in the log for `get_detail`).

`coedit init` also shows a deny rule for the project's `.claude/settings.json`. The agent only suggests changes. That is a soft rule; the deny rule and the Claude Code sandbox give hard blocks. Windows is not tested yet: see [windows-check-list.md](openspec/docs/windows-check-list.md).

Other root scripts: `pnpm dev` (watch mode), `pnpm test`, `pnpm test:e2e:docker` (tests in real Obsidian, no window), `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm check` (lint, type check and tests).

### Reload the Obsidian plugin during development

The plugin build writes a `.hotreload` file into `packages/obsidian/dist/`. With the [Hot Reload](https://github.com/pjeby/hot-reload) plugin, Obsidian reloads MD-Coeditor after each build.

One-time setup: open `test-vault` in Obsidian. Go to Settings → Community plugins → Browse, install "Hot Reload" and turn it on. Plugins belong to one vault, so install it in `test-vault`, not in another vault.

Development loop:

1. Run `pnpm dev`. esbuild rebuilds the plugin each time you save a file.
2. Hot Reload sees the new build and reloads MD-Coeditor. A notice shows in Obsidian.

Without Hot Reload: after `pnpm build`, turn MD-Coeditor off and on in Settings → Community plugins, or run "Reload app without saving" from the command palette.

For all steps and options, see [install.md](openspec/docs/install.md).

## OpenSpec

OpenSpec is a spec-driven workflow for development with AI coding assistants. Before you change the code, you write down what must change and why. You and the AI agree on the specs. Then the AI writes the code.

Install the OpenSpec CLI:

```sh
pnpm add -g @fission-ai/openspec@latest
```

### Structure

```
openspec/
├── config.yaml        # OpenSpec settings and project context
├── docs/              # Project-wide documents (vision, roadmap, architecture, tech stack, install, initial plan)
├── specs/             # The current specs. This is how the system works now.
└── changes/           # Proposed changes. Each change has its own folder.
    └── archive/       # Completed changes
```

- **Specs** (`openspec/specs/`) show the current behavior of the system.
- **Changes** (`openspec/changes/`) show proposed updates. A change folder contains a proposal, a design, tasks, and spec deltas.
- When a change is complete, you archive it. OpenSpec then merges the spec deltas into `openspec/specs/`.
- **Docs** (`openspec/docs/`) are not part of the OpenSpec format. OpenSpec does not read them.

### Workflow

Use these commands in Claude Code:

| Command | What it does |
| --- | --- |
| `/opsx:explore` | Think through an idea before you make a proposal. |
| `/opsx:propose "<idea>"` | Make a new change with a proposal, design, tasks, and spec deltas. |
| `/opsx:update` | Update the documents of a change. |
| `/opsx:apply` | Do the tasks of a change. |
| `/opsx:sync` | Merge the spec deltas of a change into the main specs. |
| `/opsx:archive` | Archive a completed change. |

Useful CLI commands:

```sh
openspec list        # Show the active changes
openspec view        # Show a dashboard of specs and changes
openspec validate    # Check changes and specs for errors
```

### More information

- Website: https://openspec.dev/
- Source: https://github.com/Fission-AI/OpenSpec
