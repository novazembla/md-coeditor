# Handover

Date: 2026-10-24. This file tells the next person (or agent session) where the project is, what was decided, and what comes next. Most important: the decisions that change the initial plan.

## 1. Status

- **Planning only. There is no code.** Git has no commits yet. All files are untracked.
- One OpenSpec change is ready for review: `openspec/changes/setup-monorepo/` (proposal, spec, design, tasks). It is valid (`openspec validate setup-monorepo --strict`). It is not applied.
- There are no main specs yet (`openspec/specs/` is empty).

## 2. Where to read

| File | Contents | State |
|---|---|---|
| `~/.claude/plans/zany-petting-starfish.md` | The initial plan | **Partly old.** Section 4 of this file lists what changed. When the plan and the docs disagree, the docs win. |
| `openspec/docs/architecture.md` | Components, diagram, the `coedit` binary, `coedit init`, git rules, slice 1 flow | Current |
| `openspec/docs/tech-stack.md` | Tools, packages, builds, Claude plugin, corporate setting, distribution | Current, except the items in section 6 |
| `openspec/docs/install.md` | Development install | Partly old (section 6) |
| `README.md` | Summary for human developers | Partly old (section 6) |
| `CLAUDE.md` | Short rules for agents | Partly old (section 6) |
| `openspec/changes/setup-monorepo/` | Change 0: monorepo setup | Ready for review |
| `openspec/config.yaml` | OpenSpec settings | The user added a rule: before archive, copy lasting design decisions from `design.md` into `openspec/docs/`. |

`openspec/docs/` is not part of the OpenSpec format. OpenSpec does not read it. We chose this folder for project-wide documents.

## 3. What the product is (short)

MD-Coeditor gives Word-like track changes for Markdown notes in Obsidian. Claude Code runs as an interactive session in a separate terminal. The agent only suggests: each change is a CriticMarkup mark in the note. The user accepts or rejects it in Obsidian. The agent sees the decisions on the next prompt. The user starts every agent action by hand. The command-line tool is `coedit`.

## 4. Decisions that change the initial plan

### 4.1 Name and place

- The project is **md-coeditor** (the plan said "coedit (working title)"). The CLI stays **`coedit`**, and the vault folder stays **`.coedit/`**.
- The project lives in **this repo** (the plan said "new repo, location TBD"). It is one monorepo.

### 4.2 Scope: Claude Code only

- **Codex is deferred.** The user has no access to Codex.
- Removed for now: spike S3, `adapters/codex`, `coedit codex`, and the Codex rows of the delivery design.
- Gemini and Pi stay "later".
- The design must stay agent-neutral, so Codex can be added later.

### 4.3 Systems: macOS and Windows

- The plan assumed macOS (for example "opens Terminal/iTerm"). Now **macOS and Windows must both work**. Linux should work, but it is not a test target.
- Rules (setup-monorepo design D4b):
  - Scripts are Node scripts only, with no shell commands.
  - Code joins paths with `node:path`.
  - `.gitattributes` sets LF line endings.
  - Windows does not rely on the shebang line or on symlinks. It uses a `coedit.cmd` shim and directory junctions.
  - The Claude plugin calls `node …/coedit.mjs` directly.
- Known later risk: on Windows, `claude` can be `claude.exe` or `claude.cmd`. Node can start a `.cmd` file only with a shell. The launcher change must handle both.

### 4.4 "Server" is now "bridge"

- The plan's `packages/server` is renamed **`packages/bridge`**. The word "server" caused confusion: Obsidian is the serving side.
- The **hub** in the Obsidian plugin is the only network server (WebSocket on 127.0.0.1).
- The **bridge** (`coedit mcp`) is an MCP server in MCP's meaning only. Claude Code starts it as a child process over stdio. It is a *client* of the hub.
- **Why a bridge, and not MCP over HTTP from Obsidian:**
  - Channels (push) need a stdio subprocess.
  - File mode needs a process that runs when Obsidian is closed.
  - The bridge reads the port and token from `endpoint.json` at run time.
- **Slice 1: the bridge is thin.** The tool logic (rebase, write marks, log) is in the hub. The plan had put a "transport-agnostic core" in `packages/server`. The bridge gets its own logic later, for file mode.

### 4.5 New package: `packages/protocol`

It holds the hub ⇄ bridge messages and the log event types, as zod schemas. The plan did not have it.

### 4.6 The Claude adapter is a real Claude Code plugin

- The plan's launcher passed `--agent`, `--mcp-config` and `--settings <hooks>`. Now `adapters/claude` is a **Claude Code plugin** that contains the MCP config, the hooks, the agent definition and the Edit/Write guard.
- The plugin has **`defaultEnabled: false`**. It never switches on by itself.
- **`coedit claude` switches it on for one session only:**
  - Installed from a marketplace: `claude --settings '{"enabledPlugins":{"md-coeditor@md-coeditor":true}}'`
  - Not installed: `claude --plugin-dir <bundled plugin> --settings '{"enabledPlugins":{"md-coeditor@inline":true}}'`. `defaultEnabled: false` also applies to `--plugin-dir`, so `--settings` is needed here too.
- **Never enable it at user scope or project scope.** Project scope would load it in every `claude` session in the vault.
- **The plugin is self-contained.** It has its own copy of `coedit.mjs` in `dist/`, because a marketplace install copies only the plugin folder.
- **No `bin/` folder in the plugin.** Claude Code puts `bin/` on the agent's Bash PATH, and then the agent could run `coedit inbox --mark-read` itself.
- A local marketplace file goes in `.claude-plugin/marketplace.json` at the repo root.

### 4.7 Corporate setting

The user wants the product to work in a company. Managed settings can block parts of it:

- An administrator can turn off `--plugin-dir`, or allow only some marketplaces. Then the marketplace install is the main path.
- `allowManagedHooksOnly` stops our hooks.
- MCP allowlists can block the bridge.
- Push needs `channelsEnabled`, and an `allowedChannelPlugins` entry. That entry needs a marketplace install.

Details are in `tech-stack.md` → "Corporate setting".

### 4.8 The `coedit` binary

The user wants one binary, not a shell script or an alias. It has four subcommands:

| Subcommand | Who runs it | Purpose |
|---|---|---|
| `coedit init` | The user, one time for each vault | Prepares a vault. This is **new**; the plan did not have it. |
| `coedit claude [--doc note.md]` | The user, or the Obsidian command "Start co-editor" | The launcher |
| `coedit inbox --digest --mark-read` | The `UserPromptSubmit` hook | Makes the digest for the agent |
| `coedit mcp` | Claude Code | The bridge |

`coedit init` (details in `architecture.md`):

1. It finds the vault (`.obsidian/`).
2. It installs the Obsidian plugin into the vault: it copies the files, or with `--dev` it makes a link.
3. It checks the Claude plugin.
   - It shows the install commands for user scope, if the plugin is not installed.
   - It never installs the plugin itself. In a company, that is the user's decision.
   - It never suggests project scope.
4. It creates `.coedit/` with `config.json` and `.coedit/.gitignore`.

It is idempotent. Other commands also work without `init`.

### 4.9 Git rules (new)

- Notes are committed **with their marks and comments inline**. The review state travels with the note, like a Word file. A warning for open marks can come later.
- **The event log is not committed.** The plan treated the log as ledger, outbox and trail. Now it is local only.
- Committed: `config.json` and `style.md`.
- Ignored, through `.coedit/.gitignore`: `endpoint.json` (it contains the token), `cursor.json`, `log/`, `snapshots/`, `*.sock` and `*.lock`.
- `init` never changes the vault's own `.gitignore`.

### 4.10 One writer for each file (new)

The hub writes the notes, the log and `endpoint.json`. The bridge and `coedit inbox` write only `cursor.json`.

### 4.11 Incremental plan: first slice

The plan had phases 0–5. Now the work is a set of OpenSpec changes:

- **Change 0, `setup-monorepo`:** packages, builds, tests, lint, the `coedit` skeleton (`--version`, `--help`). It is ready for review.
- **Slice 1:** the smallest end-to-end loop. It uses only `{++…++}` and `{--…--}`, and three changes:
  1. `add-insert-delete-format`: `packages/format`. Parse, serialize, suggest, accept, reject, protected zones (frontmatter, fenced code). Unit tests only.
  2. `add-obsidian-review-basics`: the plugin renders the marks and has accept/reject commands. There is no agent yet.
  3. `add-claude-suggest-loop`: hub, bridge, event log, digest, `coedit init`, `coedit claude`, the pull hook and the guard.
- **Rules for slice 1:**
  - A replace becomes two marks, `{--old--}{++new++}`. Each mark has its own id and its own decision.
  - The find text must match the clean text outside pending marks. If it overlaps a pending mark, the tool refuses it.
  - No file mode. If Obsidian is closed, `suggest_edit` returns "Obsidian not connected".
  - Pull only. There are no channels yet.
- **Slice 1 end-to-end test:**
  1. The agent suggests a change.
  2. The marks appear in Obsidian.
  3. The user accepts one and rejects one.
  4. The next prompt gets a digest of the decisions.
  5. The guard blocks a direct Edit.
  6. A plain `claude` session has no co-editor tools.
- **Spikes stay outside OpenSpec** in `spikes/`, as throwaway code. They do not block slice 1:
  - S1: live tracking. Change 7 needs it.
  - S2: channels. Change 4 needs it.
- **Later changes, roughly in this order:**
  - `add-agent-push`
  - `add-substitution-and-comments`
  - `add-review-panel`
  - `add-live-tracking`
  - `add-file-mode`
  - `add-external-changes`
  - `add-editor-toolbars-and-display-modes`
  - `add-intent-verbs`
- **Proposed capability names:**
  - `markup-format`
  - `change-decisions`
  - `markup-rendering`
  - `note-attachment`
  - `vault-hub`
  - `event-log`
  - `agent-tools`
  - `context-digest`
  - `coedit-cli` (was `agent-launcher`)
  - `claude-plugin` (was `claude-adapter`)

### 4.12 Tech stack (new details)

The plan said only "pnpm workspaces, TypeScript". Now:

| Area | Choice |
|---|---|
| Monorepo | pnpm 12 workspaces, with a `catalog:` for shared versions. No Turborepo or Nx. |
| Language and runtime | TypeScript 7 (fallback: TypeScript 6), strict, ESM. Node `>=24.15` for development (jsdom needs it), `>=24` for the `coedit` runtime. |
| Builds | esbuild. The plugin is CommonJS, with Obsidian's `@codemirror/*` and `@lezer/*` kept external. The bridge is one ESM file **`coedit.mjs`** (not `.js`), with a shebang line and a `createRequire` banner. |
| Shared code | Internal packages export TypeScript source. They have no build step. |
| Tests | vitest 5. jsdom 30 for the CodeMirror tests. `@codemirror/state` 6.7.6 and `@codemirror/view` 6.43.13 are pinned to the versions that `obsidian` 1.14.4 declares. |
| Lint and format | Biome. The official sample plugin uses ESLint with `eslint-plugin-obsidianmd`; we add that only if we publish to the community store. |
| Runtime packages | `@modelcontextprotocol/sdk` (stdio), zod, `ws` (plugin only; the bridge uses Node's built-in `WebSocket`), `node:util` `parseArgs`. Each comes with the change that first uses it. |
| Put `coedit` on the PATH | pnpm 11 removed `pnpm link --global`. Instead, `pnpm link:bin` makes a symlink in `~/.local/bin` on macOS, and writes a `coedit.cmd` file in `%LOCALAPPDATA%\md-coeditor\bin` on Windows. |
| Distribution | 1: link script (development). 2: one npm package `md-coeditor` that contains the binary, both plugins and `marketplace.json`. 3 (optional): a single binary. |

## 5. Checks that are not verified yet

| Check | Where |
|---|---|
| A plugin with `defaultEnabled: false` stays off when installed at user scope, and `--settings` switches it on for one session (marketplace id and `@inline`). | Spike S2 or slice 1 |
| Which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`). | Spike S2 |
| The esbuild ESM bundle of the MCP SDK runs. Alternative: import only the stdio subpaths, or bundle as CommonJS. | Slice 1, first task |
| `pnpm add -g ./packages/bridge` links (it does not copy). | Optional |
| TypeScript 7 works with the `obsidian` types. | setup-monorepo |
| Everything works on Windows. There is no Windows machine here. | setup-monorepo task 9.3 (manual, by the user) |
| From the plan, still open: structural edits, IME, Vim mode and auto-pair in live tracking. | Spike S1 |

## 6. Known doc drift (fixed by setup-monorepo task 8.1)

`README.md`, `CLAUDE.md`, `openspec/docs/install.md` and `openspec/docs/tech-stack.md` still say some old values in places:

| Old | New |
|---|---|
| pnpm 10 | pnpm 12 |
| `pnpm link --global` | `pnpm link:bin` |
| `coedit.js` | `coedit.mjs` |
| Node 24 LTS | Node `>=24.15` for development |

install.md already has a note about this. The plan file also still says `packages/server`, Terminal/iTerm, and the Codex parts.

## 7. Developer machine (observed 2026-10-24)

| Tool | Version | Note |
|---|---|---|
| Node | v24.9.0 | **Too old for jsdom 30. Update to ≥ 24.15** (task 1.1). |
| pnpm | 12.15.0 | |
| Claude Code | 2.1.310 | |
| Obsidian | 1.14.5 | |
| OpenSpec CLI | 1.15.0 | |

## 8. User preferences

- Use simple language (ASD-STE100), and extend the vocabulary with domain terms (`CLAUDE.md`).
- Do not create claude.ai assets unless the user asks.
- Build incrementally: the smallest end-to-end slice first.
- Use Sonnet subagents where it fits, for mechanical work and research.
- Do not mention Dropbox in docs. It is not relevant.
- Windows support matters. The product must be usable in a company.

## 9. Next steps

1. The user reviews `openspec/changes/setup-monorepo/` (most important: `design.md` and `tasks.md`).
2. The user updates Node to ≥ 24.15.
3. Apply the change with `/opsx:apply`. Plan: give the internal packages, the Claude plugin skeleton, the test vault and the docs to Sonnet subagents. Do the root workspace and the integration check yourself.
4. Before archive: copy lasting decisions from `design.md` into `openspec/docs/` (rule in `openspec/config.yaml`). Then archive. This creates `openspec/specs/coedit-cli/spec.md`.
5. Make the first commit on a branch (the repo has no commits; ask the user before you commit).
6. Propose slice 1, change 1: `add-insert-delete-format`.
7. Spikes S1 and S2 can start in parallel in `spikes/`.
