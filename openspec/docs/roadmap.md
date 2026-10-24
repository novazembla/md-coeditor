# Roadmap

This file is the big picture: the slices, the OpenSpec changes in each slice, their order, their dependencies and their status. OpenSpec itself has no roadmap. It knows only the current specs (`openspec/specs/`) and the active changes (`openspec/changes/`). This file connects them.

For the parts and how they connect, see [architecture.md](architecture.md). For tools and builds, see [tech-stack.md](tech-stack.md).

## How to use this file

- **Before you propose a change**, find it here. Use its name, its scope and its capabilities. If the plan must change, change this file in the same change.
- **When a change moves to a new status**, update its row. Do this in the same commit as the change work.
- **Capabilities column**: the spec folders that the change adds to or modifies. Two changes that modify the same requirement in the same capability must be archived in order. The second change must then be updated to the new spec text. For planned changes, the capabilities are expected values. Confirm them when you write the proposal.
- **Status values**:
  - `planned`: only a row in this file.
  - `proposed`: the change folder exists, the artifacts are in progress.
  - `specified`: all artifacts are done and valid, ready for review.
  - `applying`: implementation is in progress.
  - `archived`: done. The deltas are in `openspec/specs/`.
- The scope of planned changes comes from the [initial plan](initial-plan.md). It is frozen and partly old. When it disagrees with the other docs, the other docs win. Each change must serve the [vision](vision.md).

## Status overview

Updated 2026-10-24.

| # | Change | Slice | Status | Note |
|---|---|---|---|---|
| 0 | `setup-monorepo` | 0 | archived | `openspec/changes/archive/2026-10-24-setup-monorepo/`. |
| 1 | `add-insert-delete-format` | 1 | archived | `openspec/changes/archive/2026-10-24-add-insert-delete-format/`. Follow-ups: see "Follow-ups from change 1". |
| 2 | `add-obsidian-review-basics` | 1 | planned | Next. Do the mark dialect open check first. |
| 3 | `add-claude-suggest-loop` | 1 | planned | |
| 4 | `add-agent-push` | later | planned | Needs spike S2. |
| 5 | `add-substitution-and-comments` | later | planned | |
| 6 | `add-review-panel` | later | planned | |
| 7 | `add-live-tracking` | later | planned | Needs spike S1. |
| 8 | `add-file-mode` | later | planned | |
| 9 | `add-external-changes` | later | planned | |
| 10 | `add-editor-toolbars-and-display-modes` | later | planned | |
| 11 | `add-intent-verbs` | later | planned | |

## Slice 0: monorepo

### 0. `setup-monorepo`

- **Scope:** packages, builds, tests, lint, the `coedit` skeleton (`--version`, `--help`).
- **Depends on:** nothing.
- **Capabilities:** `coedit-cli` (added).

## Slice 1: the smallest end-to-end loop

The agent suggests, the user accepts or rejects in Obsidian, and the agent sees the decisions on the next prompt. Slice 1 uses only `{++…++}` and `{--…--}`.

The three changes are in sequence: each one builds on the one before it.

### 1. `add-insert-delete-format`

- **Scope:** `packages/format`. Parse and serialize, protected zones (frontmatter, fenced, indented and inline code, tables), suggest, accept, reject, mark ids. The other CriticMarkup kinds are recognized and kept as they are. Unit tests only.
- **Depends on:** 0.
- **Capabilities:** `markup-format` (added), `change-decisions` (added).

### 2. `add-obsidian-review-basics`

- **Scope:** the Obsidian plugin renders the marks and has accept and reject commands. No agent yet.
- **Depends on:** 1.
- **Capabilities (expected):** `markup-rendering` (added), `change-decisions` (modified: the Obsidian commands).

### 3. `add-claude-suggest-loop`

- **Scope:** hub, bridge, event log, digest, `coedit init`, `coedit claude`, the pull hook (`UserPromptSubmit`) and the Edit/Write guard.
- **Depends on:** 1, 2. The hub runs in the Obsidian plugin.
- **Capabilities (expected):** `vault-hub`, `event-log`, `agent-tools`, `context-digest`, `note-attachment`, `claude-plugin` (all added); `coedit-cli` (modified: `init`, `claude`, `inbox`, `mcp`); `change-decisions` (modified: decisions are logged).

### Rules for slice 1

- A replace becomes two marks, `{--old--}{++new++}`. Each mark has its own id and its own decision.
- The find text must match the clean text outside pending marks. If it overlaps a pending mark, the tool refuses it.
- No file mode. If Obsidian is closed, `suggest_edit` returns "Obsidian not connected".
- Pull only. No channels.

### Slice 1 end-to-end test

1. The agent suggests a change.
2. The marks appear in Obsidian.
3. The user accepts one and rejects one.
4. The next prompt gets a digest of the decisions.
5. The guard blocks a direct Edit.
6. A plain `claude` session has no co-editor tools.

## Later changes

These are in rough order. They are not grouped into slices yet. Before slice 2 starts, group them into slices here, each with its own end-to-end test.

| # | Change | Scope (short) | Depends on (expected) | Capabilities (expected) |
|---|---|---|---|---|
| 4 | `add-agent-push` | Push on the user's click through a Claude channel. Nudge in the status bar if push is not available. | 3, spike S2 | `claude-plugin`, `vault-hub`, `context-digest` |
| 5 | `add-substitution-and-comments` | Decisions on `{~~…~>…~~}`, comment threads, the `comment` and `reply` tools. | 3 | `markup-format`, `change-decisions`, `markup-rendering`, `agent-tools` |
| 6 | `add-review-panel` | The review panel: prev/next, accept all, reject all, filters, cards with threads, footer outbox. | 2 (5 for threads) | `markup-rendering` or a new `review-panel` |
| 7 | `add-live-tracking` | The per-vault Track Changes toggle: user edits become marks. | 2, spike S1 | `markup-format` (tracking transforms), `markup-rendering` |
| 8 | `add-file-mode` | Agent suggestions when Obsidian is closed: safe writes, decisions in the log only. | 3 | `agent-tools`, `event-log`, `coedit-cli` |
| 9 | `add-external-changes` | Edits from other tools: banner, `external` marks, Refresh. | 3 | `event-log`, `context-digest`, `markup-format` |
| 10 | `add-editor-toolbars-and-display-modes` | Floating change toolbar, selection bubble, display modes. | 2 | `markup-rendering` |
| 11 | `add-intent-verbs` | Ask on a selection, the finish-pass verbs with an instruction field, working and seen states. | 3, 6 | `agent-tools`, `context-digest`, `vault-hub` |

### Follow-ups from change 1

The reviews of `add-insert-delete-format` found these points. They are not in change 1. Each one names the change that takes it.

| Follow-up | Take in |
|---|---|
| Error details (match count for `ambiguous`, zone kind for `protected_zone`) and one error-code union per function. | 3 (the agent reads the errors) |
| A readonly, discriminated `Mark` type (one shape per kind), and a decision about `serialize` (now it always returns the input text). | 2, before the plugin depends on the types |
| API consistency: `decide` takes an input object like `suggest`, `Result` keys cannot collide with result fields, `date` gets a calendar check. | 2, before the plugin depends on the API |
| More protected zones: backslash-escaped backticks, `[[wikilinks]]` (a suggestion can split them), callout markers `> [!note]`. | 3 (the agent writes into notes) |
| Word boundaries for CJK text (now a word is a run of non-whitespace, so one changed character marks the whole run). | 3, decide in its proposal |
| `decideMany` for accept all and reject all (one `decide` per mark is O(marks × length)). | 6 |
| `coedit-cli` bundle tests for no arguments and an unknown option, and a check that the tested bundle is not stale. | 3 (it modifies `coedit-cli`) |

### Parallel work

After slice 1, some changes do not share capabilities and can run at the same time on separate branches. For example, `add-file-mode` (8) and `add-editor-toolbars-and-display-modes` (10). Changes that share a capability (for example 5, 6, 7 and 10 all touch `markup-rendering`) need an agreed archive order.

## Spikes

Spikes stay outside OpenSpec in `spikes/`, as throwaway code. They do not block slice 1. They can start at any time.

| Spike | Question | Needed by | Status |
|---|---|---|---|
| S1 | Live tracking in Live Preview: boundary typing, undo and redo, paste, structural edits, IME, Vim mode, auto-pair. If it fails: shadow diff. | 7 | not started |
| S2 | Custom channel: a click in Obsidian becomes an event in the interactive `claude` session. Which channel flag value works for each load method. | 4 | not started |
| S3 | Codex push | — | deferred: no access to Codex |

## Open checks

| Check | Where |
|---|---|
| A plugin with `defaultEnabled: false` stays off at user scope, and `--settings` switches it on for one session (marketplace id and `@inline`). | S2 or change 3 |
| Which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`). | S2 |
| The esbuild ESM bundle of the MCP SDK runs. Alternative: import only the stdio subpaths, or bundle as CommonJS. | Change 3, first task |
| Everything works on Windows. There is no Windows machine here. | Manual, by the user |
| Structural edits, IME, Vim mode and auto-pair in live tracking. | S1 |
| The mark dialect (attribute prefix in the braces) works with existing Obsidian CriticMarkup plugins, or we move the attributes (for example into an HTML comment). See the design of change 1, D4 and Open Questions. | Before change 2 |

## Capabilities

The planned spec folders and the changes that touch them.

| Capability | Main spec exists | Changes |
|---|---|---|
| `coedit-cli` | yes | 0, 3, 8 |
| `markup-format` | yes | 1, 5, 7, 9 |
| `change-decisions` | yes | 1, 2, 3, 5 |
| `markup-rendering` | no | 2, 5, 6, 7, 10 |
| `note-attachment` | no | 3 |
| `vault-hub` | no | 3, 4, 11 |
| `event-log` | no | 3, 8, 9 |
| `agent-tools` | no | 3, 5, 8, 11 |
| `context-digest` | no | 3, 4, 9, 11 |
| `claude-plugin` | no | 3, 4 |
