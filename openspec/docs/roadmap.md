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

Updated 2026-10-25.

| # | Change | Slice | Status | Note |
|---|---|---|---|---|
| 0 | `setup-monorepo` | 0 | archived | `openspec/changes/archive/2026-10-24-setup-monorepo/`. |
| 1 | `add-insert-delete-format` | 1 | archived | `openspec/changes/archive/2026-10-24-add-insert-delete-format/`. Follow-ups: see "Follow-ups from change 1". |
| 2 | `add-obsidian-review-basics` | 1 | archived | `openspec/changes/archive/2026-10-24-add-obsidian-review-basics/`. Windows check not done (see Open checks). |
| 12 | `add-obsidian-e2e-tests` | 1 | archived | `openspec/changes/archive/2026-10-24-add-obsidian-e2e-tests/`. Test setup: [testing.md](testing.md). Windows run not done (see Open checks). |
| 3 | `add-claude-suggest-loop` | 1 | specified | `openspec/changes/add-claude-suggest-loop/`. Revised after a red-team review on 2026-10-25. |
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

The changes are in sequence, in this order: 1, 2, 12, 3. Each one builds on the one before it.

### 1. `add-insert-delete-format`

- **Scope:** `packages/format`. Parse and serialize, protected zones (frontmatter, fenced, indented and inline code, tables), suggest, accept, reject, mark ids. The other CriticMarkup kinds are recognized and kept as they are. Unit tests only.
- **Depends on:** 0.
- **Capabilities:** `markup-format` (added), `change-decisions` (added).

### 2. `add-obsidian-review-basics`

- **Scope:** the Obsidian plugin renders the marks and has accept and reject commands. No agent yet.
- **Depends on:** 1.
- **Capabilities:** `markup-rendering` (added); `change-decisions` (modified: the Obsidian commands); `markup-format` (modified: attribute values have no `{` or `}`, a tab separates attributes, `date` is a real calendar date).

### 12. `add-obsidian-e2e-tests`

- **Scope:** end-to-end tests in the real Obsidian app with [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service) (WebdriverIO, mocha), in a new package `packages/e2e`. It downloads a pinned Obsidian version, opens a copy of a fixture vault in `packages/e2e/vault/` (not `test-vault/`), loads the built plugin, and runs the tests. A root script `pnpm test:e2e`, not part of `pnpm check` (it is slow and needs a display). First tests: the manual checks of change 2 that jsdom cannot do (cursor motion over hidden syntax with real layout, the right-click menu, the command palette in each mode, notices, file reload from disk, Reading view). Later changes add their own end-to-end tests here, also the slice 1 end-to-end test. From this change on, e2e tests are the strong default for plugin behaviour (rules in `openspec/config.yaml`).
- **Why:** jsdom has no layout and no Obsidian. In change 2, a real bug (two key presses at a mark edge) passed all unit tests. Manual checks are slow and do not repeat.
- **Depends on:** 2.
- **Capabilities:** none (test tooling only). The change sets `skip_specs: true`: it adds tests for the scenarios of `markup-rendering` and `change-decisions`, and no behaviour changes.
- **Open points (answered):** Linux runs in Docker with a virtual display (`pnpm test:e2e:docker`, added during apply), so a run needs no window. Windows runs are not in this change; the tests are written so that they need config changes only (open check). The pinned version is the plugin's `minAppVersion` (1.14.4), with the installer 1.14.4. Details: [testing.md](testing.md).

### 3. `add-claude-suggest-loop`

- **Scope:** hub, bridge with the MCP tools (`get_context`, `read_note`, `suggest_edit`, `get_detail`, `get_digest`), one event log for each machine, digest, `coedit init`, `coedit claude`, `coedit inbox`, `coedit mcp`, the pull hook (`UserPromptSubmit`), and the format follow-ups A, B and D. No note attachment and no guard: the focus is Obsidian's active note, and protection is soft (tool descriptions, optional profile, a deny rule that `coedit init` shows). Machine-local state is in `.coedit/local/<machine>/`. `note-attachment` was dropped in change 3.
- **Depends on:** 1, 2, 12. The hub runs in the Obsidian plugin.
- **Capabilities:** `vault-hub`, `event-log`, `agent-tools`, `context-digest`, `claude-plugin` (all added); `coedit-cli` (modified: `init`, `claude`, `inbox`, `mcp`); `change-decisions` (modified: decisions are logged); `markup-format` (modified: wikilink and callout-marker zones, the inline code backslash rule, refusal details).

### Rules for slice 1

- A replace becomes two marks, `{--old--}{++new++}`. Each mark has its own id and its own decision.
- The find text must match the clean text outside pending marks. If it overlaps a pending mark, the tool refuses it.
- No file mode. If Obsidian is closed, `suggest_edit` returns "Obsidian not connected".
- Pull only. No channels.
- Protection is soft. Hard blocks come from the project's Claude Code permissions.

### Slice 1 end-to-end test

1. The agent suggests a change.
2. The marks appear in Obsidian.
3. The user accepts one and rejects one.
4. The next prompt gets a digest of the decisions.
5. With the documented project deny rule, a direct Edit is blocked.
6. A plain `claude` session has no co-editor tools.

## Later changes

These are in rough order. They are not grouped into slices yet. Before slice 2 starts, group them into slices here, each with its own end-to-end test.

| # | Change | Scope (short) | Depends on (expected) | Capabilities (expected) |
|---|---|---|---|---|
| 4 | `add-agent-push` | Push on the user's click through a Claude channel. Nudge in the status bar if push is not available. The push is a short pointer (`N new decisions: call get_digest`), never the decisions. The hub knows the sessions from `hello.session` and only reads `.coedit/local/<machine>/cursors/<session>.json` to count unsent decisions. It uses the reserved `event` message and the `push` feature (design D19 of change 3). | 3, spike S2 | `claude-plugin`, `vault-hub`, `context-digest` |
| 5 | `add-substitution-and-comments` | Decisions on `{~~…~>…~~}`, comment threads, the `comment` and `reply` tools. The `comment` option of `suggest_edit` (the reason becomes a comment on the change). Comments to the agent as a new digest item type. | 3 | `markup-format`, `change-decisions`, `markup-rendering`, `agent-tools`, `context-digest` |
| 6 | `add-review-panel` | The review panel: prev/next, accept all, reject all, filters, cards with threads, footer outbox. The status bar list of notes with changes (moved from change 3). `decideMany` (see the follow-ups from change 1). | 2 (5 for threads) | `markup-rendering` or a new `review-panel` |
| 7 | `add-live-tracking` | The per-vault Track Changes toggle: user edits become marks. CJK word boundaries (`Intl.Segmenter`, follow-up C). An author name in `config.json` for the user's own marks. | 2, spike S1 | `markup-format` (tracking transforms), `markup-rendering` |
| 8 | `add-file-mode` | Agent suggestions when Obsidian is closed: safe writes, decisions in the log only. Rebase for flows that wait. A second log writer, which appends under the lock `log/events.lock` and reads the last `seq` again under it (design D21 of change 3). | 3 | `agent-tools`, `event-log`, `coedit-cli` |
| 9 | `add-external-changes` | Edits from other tools: banner, `external` marks, Refresh. Rebase. Detect an undo of a decision and log it. Detect an undo of a suggestion and a mark deleted by hand, and log it as a new event type with the outcome "neither accepted nor rejected". The rule "the latest event for a mark wins" covers every event type that sets a mark's state (design D6 of change 3). A `delete` event for deleted notes. | 3 | `event-log`, `context-digest`, `markup-format` |
| 10 | `add-editor-toolbars-and-display-modes` | Floating change toolbar, selection bubble, display modes. | 2 | `markup-rendering` |
| 11 | `add-intent-verbs` | Ask on a selection, the finish-pass verbs with an instruction field, working and seen states. The `finish` tool. "Ask on a selection" uses the selection of `get_context` in view coordinates (design D5 of change 3). | 3, 6 | `agent-tools`, `context-digest`, `vault-hub` |

### Follow-ups from change 1

The reviews of `add-insert-delete-format` found these points. They are not in change 1. Each one names the change that takes it. The column "State" shows if the change has done it. Later changes add their follow-ups here too.

| Follow-up | Take in | State |
|---|---|---|
| Error details (match count for `ambiguous`, zone kind for `protected_zone`) and one error-code union per function. | 3 (the agent reads the errors) | in change 3 (task 1.2) |
| A readonly, discriminated `Mark` type (one shape per kind), and a decision about `serialize` (now it always returns the input text). | 2, before the plugin depends on the types | done in 2 |
| API consistency: `decide` takes an input object like `suggest`, `Result` keys cannot collide with result fields, `date` gets a calendar check. | 2, before the plugin depends on the API | done in 2 |
| More protected zones: backslash-escaped backticks, `[[wikilinks]]` (a suggestion can split them), callout markers `> [!note]`. | 3 (the agent writes into notes) | in change 3 (task 1.1) |
| Word boundaries for CJK text (now a word is a run of non-whitespace, so one changed character marks the whole run). | 7 (decided in 3: not in slice 1) | open |
| `decideMany` for accept all and reject all (one `decide` per mark is O(marks × length)). | 6 | open |
| `coedit-cli` bundle tests for no arguments and an unknown option, and a check that the tested bundle is not stale. | 3 (it modifies `coedit-cli`) | in change 3 (task 3.2) |
| Read Commentator's `{"author":"X"}@@` data as attributes. Today the parser reads it as content, so accepting such a mark puts that text into the note. | 9 (`add-external-changes`) | open |
| Incremental parse in the Obsidian plugin. A key press in a 1.13 MB note with 3,000 marks takes 12.6 ms (limit 8 ms; design D10 of change 2). Parse only the changed paragraphs, or move the parse off the key press. | 7 (live tracking parses on each key press too) | open |

### Follow-ups from change 3

The explore session and the review of `add-claude-suggest-loop` found these points. They are not in change 3. Each one names the change that takes it. Task 11.1 of change 3 sets the rows of change 1 that change 3 takes to "done in 3" at the end of apply.

| Follow-up | Take in | State |
|---|---|---|
| `get_inbox` of the initial plan is replaced by `get_digest`. | — | decided |
| A warning for notes with open marks (other readers of the `.md` files, for example docs builds, see the raw marks). | 6 | open |
| Log rotation or a log index, when a real vault shows a need (now the digest reads the whole log; 1 MB is about 10 ms). | later | open |
| An Obsidian command that starts the co-editor. | later | open |
| An optional line range for `read_note` (`fromLine`, `toLine`) for big notes. It does not break the tool shape. | later | open |
| More protected zones: link targets `](...)`, math `$…$` and `$$` blocks, `%%comments%%`, footnote refs `[^1]`, block ids `^abc`, inline HTML. | 9, or a small format change before it | open |
| Known gaps of the pull digest: Esc while the hook runs loses that digest; a subagent that calls `get_digest` takes the decisions away from the main agent. | 4 (push), or later | open |
| The digest lists only decisions on marks that the agent suggested. Decisions on marks typed by hand stay in the log. | — | decided |

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
| A plugin with `defaultEnabled: false` stays off at user scope, and `--settings` switches it on for one session (marketplace id and `@inline`). | Answered in change 3 design (facts F1, F2, F6). Closed by task 11.1 after apply. |
| Which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`). | S2 |
| The esbuild ESM bundle of the MCP SDK runs. Alternative: import only the stdio subpaths, or bundle as CommonJS. | Answered in change 3 design (facts F1, F2, F6). Closed by task 11.1 after apply. |
| Everything works on Windows. There is no Windows machine here. Not done yet for change 2 (`add-obsidian-review-basics`, task 11.6 open at archive). The tool to close it: the e2e tests of change 12 (`pnpm test:e2e` on a Windows machine), plus the manual list in [testing.md](testing.md). | Manual, by the user |
| The e2e tests (`pnpm test:e2e`) run on Windows. Change 12 runs them on macOS and on Linux in Docker (`pnpm test:e2e:docker`). | User's Windows machine, or a later CI change |
| Structural edits, IME, Vim mode and auto-pair in live tracking. | S1 |
| Which `Origin` and `Host` headers Node's global `WebSocket` sends. | Change 3, task 4.2 |
| The JSON shape of `claude plugin list --json`. | Change 3, task 8.3 |
| `/clear`, `--continue` and `--resume` keep the launcher's session (`COEDIT_SESSION`). | Change 3, manual check 12.5 |
| `.mcp.json` `env` reaches the MCP server with `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`. | Change 3, manual check 12.5 |
| `claude plugin install` switches the plugin on at user scope, or not. | Change 3, manual check 12.3 |
| Obsidian fires a `rename` event for each note when a folder is renamed. | Change 3, task 10.3 |

### Closed checks

| Check | Result | Closed in |
|---|---|---|
| The mark dialect (attribute prefix in the braces) works with existing Obsidian CriticMarkup plugins. | Yes. Keep the attribute prefix. It is exactly the obsidian-track-changes format after two fixes: no `{` or `}` in values, and a tab may separate attributes. The other plugins (review-comments, review-critics, Inkling, Commentator) show our marks as plain text. The note is not damaged. | Change 2 (2026-10-24) |

## Capabilities

The planned spec folders and the changes that touch them.

| Capability | Main spec exists | Changes |
|---|---|---|
| `coedit-cli` | yes | 0, 3, 8 |
| `markup-format` | yes | 1, 2, 3, 5, 7, 9 |
| `change-decisions` | yes | 1, 2, 3, 5 |
| `markup-rendering` | yes | 2, 5, 6, 7, 10 |
| `vault-hub` | no | 3, 4, 11 |
| `event-log` | no | 3, 8, 9 |
| `agent-tools` | no | 3, 5, 8, 11 |
| `context-digest` | no | 3, 4, 5, 9, 11 |
| `claude-plugin` | no | 3, 4 |
