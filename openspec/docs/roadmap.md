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
- **Numbers** are ids, not the order. A new change gets the next free number. The order is the order of the slices and of the changes in each slice.
- The scope of planned changes comes from the [initial plan](initial-plan.md). It is frozen and partly old. When it disagrees with the other docs, the other docs win. Each change must serve the [vision](vision.md).

## Status overview

Updated 2026-10-25 (plan review after slice 1, see [Plan review 2026-10-25](#plan-review-2026-10-25)).

| # | Change | Slice | Status | Note |
|---|---|---|---|---|
| 0 | `setup-monorepo` | 0 | archived | `openspec/changes/archive/2026-10-24-setup-monorepo/`. |
| 1 | `add-insert-delete-format` | 1 | archived | `openspec/changes/archive/2026-10-24-add-insert-delete-format/`. Follow-ups: see "Follow-ups from change 1". |
| 2 | `add-obsidian-review-basics` | 1 | archived | `openspec/changes/archive/2026-10-24-add-obsidian-review-basics/`. Windows check not done (see Open checks). |
| 12 | `add-obsidian-e2e-tests` | 1 | archived | `openspec/changes/archive/2026-10-24-add-obsidian-e2e-tests/`. Test setup: [testing.md](testing.md). Windows run not done (see Open checks). |
| 3 | `add-claude-suggest-loop` | 1 | archived | `openspec/changes/archive/2026-10-25-add-claude-suggest-loop/`. Windows check not done (see Open checks and [windows-check-list.md](windows-check-list.md)). |
| 14 | `add-more-protected-zones` | 2 | planned | Before 13: multi-line matches can cross `$$` and `%%` blocks. |
| 13 | `add-multiline-suggestions` | 2 | planned | Unblocks co-writing. Block marks with an explicit attribute; no groups (they come in 6). |
| 15 | `add-session-continuity` | 2 | planned | Parallel to 14 and 13. |
| 6 | `add-review-panel` | 3 | planned | The panel core and groups of marks. Threads come in 5, the outbox in 11, the banner in 9. |
| 5 | `add-comments` | 3 | planned | Was `add-substitution-and-comments`. Substitution moved to 9. |
| 10 | `add-editor-toolbars-and-display-modes` | 3 | planned | |
| 4 | `add-agent-push` | 4 | planned | Needs spike S2. |
| 11 | `add-intent-verbs` | 4 | planned | Needs 4: a click in Obsidian reaches the agent only by push. |
| 8 | `add-file-mode` | 5 | planned | Owns rebase. |
| 16 | `add-mark-lifecycle-events` | 5 | planned | Split from 9. Can move earlier if users hit wrong digests. |
| 9 | `add-external-changes` | 5 | planned | |
| 7 | `add-live-tracking` | 6 | planned | Needs spike S1. |

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
5. With the documented project deny rule, a direct Edit is blocked. Result (change 3, manual check 12.4, 2026-10-25): the rule from `coedit init` (`Edit(/notes/**/*.md)` in the project's `.claude/settings.json`) blocked both Edit and Write on notes.
6. A plain `claude` session has no co-editor tools.

## Slice 2: co-writing

The agent can write real text: new paragraphs, headings, list items, poems, rewrites over more than one block. Each block is decided on its own, and every decision leaves valid Markdown. Decisions are not lost when the user resumes a conversation.

Order: 14, then 13. 15 runs in parallel.

### 14. `add-more-protected-zones`

- **Scope:** `packages/format`. The zones from the follow-ups of change 3: link targets `](...)`, math `$…$` and `$$` blocks, `%%comments%%`, footnote refs `[^1]`, block ids `^abc`, inline HTML. Update the zone table in [architecture-format.md](architecture-format.md). Unit tests, and an e2e test that a mark in a new zone does not render.
- **Why first:** with one-line suggestions, these zones are a small risk. With multi-line find and replace (13), a match can cross a `$$` block or a `%% … %%` comment, and the safety check does not see them.
- **Depends on:** 3.
- **Capabilities:** `markup-format` (modified).

### 13. `add-multiline-suggestions`

- **Scope:** `find` and `replace` with line breaks and blank lines. Today the format refuses any line break (markup-format "Unsafe suggestions are refused"). User test: "please add a second haiku in a new paragraph" was refused.
  - **Single line breaks** in a mark (a poem, lines of one paragraph). Rendering already supports them (markup-rendering "Mark over two lines").
  - **Block marks** for whole new blocks and whole deleted blocks (paragraphs, headings, list items). The block structure (the blank line, the list or heading marker) stays outside the mark as plain text, so Markdown sees it. An explicit attribute (for example `block="new"`) tells `decide` which structure belongs to the mark: a reject of a new block, or an accept of a deleted block, also removes that structure. So no extra blank line or empty list item stays. `suggest` writes the attribute. Other CriticMarkup plugins keep unknown attributes.
  - **Rewrites over more than one block:** one or more marks for each block. Each mark is decided on its own, as today.
  - The safety check ("safe in every outcome") works on each block. Because each block mark is independent, every mixed outcome is valid Markdown.
  - `read_note`, `get_detail` and the digest show block marks.
- **Not in 13:** groups (one suggestion over more than one block, decided as one unit). They come in 6.
- **Decided in the plan review (2026-10-25):** the explicit attribute, not a guess from the shape of the mark. A guess is wrong for an empty list item that existed before: its reject would delete the user's line.
- **Depends on:** 3, 14.
- **Capabilities (expected):** `markup-format`, `change-decisions`, `agent-tools`, `vault-hub` (all modified); `context-digest` (modified, if the excerpts of block marks change); `markup-rendering` (modified, if a block mark has its own look).
- **Open points:** the name and the values of the attribute (new block, deleted block). A block mark at the start or the end of the note (which blank line belongs to it). A heading or list item inside a single-line-break mark is refused (`structural_edit`) or becomes a block mark.

### 15. `add-session-continuity`

- **Scope:** three follow-ups of change 3 that touch sessions and cursors. (1) `--continue` and `--resume` reuse the co-editor session of the conversation: map Claude's `session_id` to the `COEDIT_SESSION` and reuse its cursor, so decisions made between two runs reach the digest. (2) A lock for the cursor file, so the hook and the bridge cannot move one cursor at the same time. (3) A stable machine name on macOS (`os.hostname()` can change with DHCP; for example use `scutil --get LocalHostName`).
- **Why now:** (1) loses decisions today. It was planned in 4, but 4 waits for spike S2.
- **Depends on:** 3.
- **Capabilities (expected):** `coedit-cli`, `context-digest`, `claude-plugin` (all modified); `event-log` (modified, if the machine folder rule changes).

### Slice 2 end-to-end test

1. The agent adds a new paragraph with a two-line poem, adds a list item, and rewrites two paragraphs.
2. The marks appear in Obsidian. The note structure is correct in Live Preview and in Reading view.
3. The user rejects the new paragraph and the new list item: no extra blank line and no empty list item stay. The user accepts one rewritten paragraph and rejects the other.
4. The next prompt gets a digest of the decisions.
5. The user ends the conversation, accepts one more change, and resumes the conversation with `coedit claude --continue`. The next prompt gets that decision.
6. A suggestion that would cross a `$$` block is refused with `protected_zone`.

## Slice 3: review and talk back

The user reviews all changes in one place, also changes in notes that are not open, and talks back to the agent: reject with a reason, comment, reply.

Order: 6, then 5, then 10.

### 6. `add-review-panel`

- **Scope:** the review panel (an Obsidian side view): the pending changes of all notes, grouped by note, so the user sees where the agent made suggestions (vision principle "the agent works where the user works"; open since change 3). Prev and next, accept and reject, accept all and reject all for a note (`decideMany`), filters by author and kind. The status bar count of notes with changes (moved from change 3). A warning for notes with open marks (follow-up of change 3).
- **Groups** (moved from 13 in the plan review): one suggestion over more than one block becomes a group. `suggest` writes a group attribute on each mark of the suggestion (for example `group="g7"`). A group is one card, and one action decides all its marks (`decideMany`). Each mark can still be decided on its own.
- **Not in 6:** threads in the cards (5), the external-change banner and Refresh (9), the footer outbox with counts, the instruction field and the working state (11).
- **Depends on:** 2, 13 (block marks).
- **Capabilities (expected):** `review-panel` (added); `change-decisions`, `markup-format`, `vault-hub` (modified: groups, accept all, reject all); `context-digest` (modified, if the digest shows a group as one item).
- **Open points:**
  - How the panel finds marks in notes that are not open (read and parse all notes, or an index that the hub keeps). The parse cost is known (see "Incremental parse" in the follow-ups of change 1).
  - Is a replace (`{--old--}{++new++}`) a group too? Today the spec says "Marks of a replace are decided on their own". Decide if the group rule replaces it or only adds to it.
  - The cursor commands and the right-click menu in the editor: one mark, or the whole group?
  - The log and the digest: one decision event for each group, or one for each mark?

### 5. `add-comments`

- **Scope:** comment threads in the note (`{==span==}{>>…<<}`, replies as comments next to it, as in obsidian-track-changes). In the editor, only a marker and a highlight of the span. The thread is a card in the review panel; reply, resolve and delete happen there. Reject with a reason: the reason becomes a comment, and the agent gets it. The `comment` and `reply` tools. The `comment` option of `suggest_edit` (the reason of the agent becomes a comment on the change). Comments to the agent are a new digest item type.
- **Why after 6:** in the initial plan, comments and threads are panel things. Without the panel, 5 needs its own UI for threads.
- **Depends on:** 6.
- **Capabilities (expected):** `markup-format`, `change-decisions`, `markup-rendering`, `agent-tools`, `context-digest` (all modified); `review-panel` (modified).

### 10. `add-editor-toolbars-and-display-modes`

- **Scope:** the floating change toolbar (accept, reject, reject with a reason, edit then accept, reply), the selection bubble (Comment; Ask comes in 11), the display modes (All Markup, Simple Markup, No Markup, Original).
- **Depends on:** 5 (reject with a reason, reply).
- **Capabilities (expected):** `markup-rendering` (modified); `change-decisions` (modified, if edit then accept logs the edit).
- **Open points:** does the digest tell the agent that the user edited a change before the accept (vision success item 2)?

### Slice 3 end-to-end test

1. The agent suggests changes in two notes. Only one note is open. One suggestion adds a section (a heading and two paragraphs).
2. The review panel lists both notes and their changes. The new section is one card.
3. The user accepts the section with one action, accepts all changes in the other note, rejects one change with a reason, and edits one change before the accept.
4. The next prompt gets a digest with the reason and the comment.
5. The agent replies to the comment, and the reply shows in the thread.

## Slice 4: fast loop and intent

The user starts agent work from Obsidian: a click sends the decisions, and "Ask" on a selection starts a pass.

Order: spike S2, then 4, then 11.

### 4. `add-agent-push`

- **Scope:** push on the user's click through a Claude channel. Nudge in the status bar if push is not available. The push is a short pointer (`N new decisions: call get_digest`), never the decisions. The hub knows the sessions from `hello.session` and only reads `.coedit/local/<machine>/cursors/<session>.json` to count unsent decisions. It uses the reserved `event` message and the `push` feature (design D19 of change 3). The known gaps of the pull digest (Esc while the hook runs loses that digest; a subagent that calls `get_digest` takes the decisions away from the main agent).
- **Depends on:** 3, 15 (the session mapping), spike S2.
- **Capabilities (expected):** `claude-plugin`, `vault-hub`, `context-digest` (all modified).

### 11. `add-intent-verbs`

- **Scope:** Ask on a selection, the finish-pass verbs with an instruction field, working and seen states, the footer outbox of the review panel, the `finish` tool. An Obsidian command that starts the co-editor (follow-up of change 3). "Ask on a selection" uses the selection of `get_context` in view coordinates (design D5 of change 3).
- **Depends on:** 4 (with pull only, the user must type in the terminal), 6, 10 (the selection bubble).
- **Capabilities (expected):** `agent-tools`, `context-digest`, `vault-hub`, `claude-plugin`, `review-panel` (all modified).

### Slice 4 end-to-end test

1. The user selects text in Obsidian and clicks Ask with an instruction.
2. The agent session gets the request, and the panel shows "working".
3. The suggestions appear. "Working" clears.
4. The user decides and clicks send. The agent gets the pointer and calls `get_digest`. The panel shows "seen".
5. Without a channel, the status bar shows the nudge.

## Slice 5: outside Obsidian

The agent suggests when Obsidian is closed. Edits from other tools, undo and hand deletions are visible and logged.

Order: 8 and 16 in parallel, then 9.

### 8. `add-file-mode`

- **Scope:** agent suggestions when Obsidian is closed: safe writes, decisions in the log only. Rebase (move a waiting edit onto changed text) in `packages/format`: this change is the first one that needs it. A second log writer, which appends under the lock `log/events.lock` and reads the last `seq` again under it (design D21 of change 3).
- **Depends on:** 3.
- **Capabilities (expected):** `agent-tools`, `event-log`, `coedit-cli`, `markup-format` (all modified).

### 16. `add-mark-lifecycle-events`

- **Scope:** split from 9. Detect an undo of a decision and log it. Detect an undo of a suggestion and a mark deleted by hand, and log it as a new event type with the outcome "neither accepted nor rejected". The rule "the latest event for a mark wins" covers every event type that sets a mark's state (design D6 of change 3). A `delete` event for deleted notes.
- **Why on its own:** it makes the digest correct for edits in Obsidian. It needs no external-change UI. It can move to an earlier slice if users get wrong digests after an undo.
- **Depends on:** 3.
- **Capabilities (expected):** `event-log`, `context-digest`, `vault-hub` (all modified).

### 9. `add-external-changes`

- **Scope:** edits from other tools: the banner in the review panel, `external` marks, Refresh. Decisions on substitutions `{~~…~>…~~}` (moved from 5: we write a replace as two marks, so substitutions come from other tools, and maybe from live tracking). Read Commentator's `{"author":"X"}@@` data as attributes (follow-up of change 1).
- **Depends on:** 6, 8 (rebase), 16.
- **Capabilities (expected):** `event-log`, `context-digest`, `markup-format`, `change-decisions`, `markup-rendering`, `review-panel` (all modified).

### Slice 5 end-to-end test

1. The user closes Obsidian. The agent suggests a change.
2. The user opens Obsidian. The marks render, and the decisions reach the digest.
3. The user edits the note in another editor. Obsidian shows the banner and `external` marks.
4. The user accepts a change and undoes it with Cmd+Z / Ctrl+Z. The digest shows the undo.

## Slice 6: own edits

Track changes for the user's own edits, with no agent session.

Order: spike S1, then 7.

### 7. `add-live-tracking`

- **Scope:** the per-vault Track Changes toggle: user edits become marks. CJK word boundaries (`Intl.Segmenter`, follow-up C). An author name in `config.json` for the user's own marks. Incremental parse (follow-up of change 1): tracking parses on each key press.
- **Depends on:** 2, spike S1; 9 if S1 decides that an overwrite becomes a substitution.
- **Capabilities (expected):** `markup-format` (tracking transforms), `markup-rendering` (both modified).

### Slice 6 end-to-end test

1. The user turns Track Changes on. No agent session runs.
2. The user types, deletes and pastes. The edits become marks with the user's author name.
3. The user accepts and rejects them. Undo and redo work.

## Plan review 2026-10-25

After slice 1, the later changes were grouped into slices. What changed, and why:

- **New 14 `add-more-protected-zones`** before 13. Multi-line matches can cross `$$` and `%%` blocks. The follow-up was planned for 9.
- **13 has block marks, and groups moved to 6.** A new or deleted block is its own mark. An explicit attribute tells `decide` which structure (blank line, list or heading marker) to remove with it, so every decision leaves valid Markdown. Groups (one suggestion over more than one block, decided as one unit) are comfort, not safety. In the panel, a group is one card, so groups and all of `decideMany` are in 6. This keeps 13 smaller.
- **New 15 `add-session-continuity`.** The `--resume` gap loses decisions today. It was planned in 4, which waits for spike S2. The cursor lock and the stable machine name touch the same code.
- **The review panel (6) moved forward, before comments (5).** Comments and threads live in the panel (initial plan). The panel also shows changes in notes that are not open; change 3 suggests into any note, but the user cannot see where. The panel scope is smaller: the outbox goes to 11, the banner to 9.
- **5 is only comments now** (`add-comments`). Substitution decisions moved to 9.
- **11 needs 4.** Ask in Obsidian reaches the agent only by push.
- **Rebase has one owner: 8.** 9 uses it.
- **16 `add-mark-lifecycle-events` split from 9.** The undo and deletion events make the digest correct without any external-change UI.
- **New capability `review-panel`** for 6, 5, 9 and 11, so they do not all queue on `markup-rendering`.

## Follow-ups from change 1

The reviews of `add-insert-delete-format` found these points. They are not in change 1. Each one names the change that takes it. The column "State" shows if the change has done it. Later changes add their follow-ups here too.

| Follow-up | Take in | State |
|---|---|---|
| Error details (match count for `ambiguous`, zone kind for `protected_zone`) and one error-code union per function. | 3 (the agent reads the errors) | done in 3 |
| A readonly, discriminated `Mark` type (one shape per kind), and a decision about `serialize` (now it always returns the input text). | 2, before the plugin depends on the types | done in 2 |
| API consistency: `decide` takes an input object like `suggest`, `Result` keys cannot collide with result fields, `date` gets a calendar check. | 2, before the plugin depends on the API | done in 2 |
| More protected zones: backslash-escaped backticks, `[[wikilinks]]` (a suggestion can split them), callout markers `> [!note]`. | 3 (the agent writes into notes) | done in 3 |
| Word boundaries for CJK text (now a word is a run of non-whitespace, so one changed character marks the whole run). | 7 (decided in 3: not in slice 1) | open |
| `decideMany` for accept all and reject all (one `decide` per mark is O(marks × length)). | 6 (groups, accept all, reject all) | open |
| `coedit-cli` bundle tests for no arguments and an unknown option, and a check that the tested bundle is not stale. | 3 (it modifies `coedit-cli`) | done in 3 |
| Read Commentator's `{"author":"X"}@@` data as attributes. Today the parser reads it as content, so accepting such a mark puts that text into the note. | 9 (`add-external-changes`) | open |
| Incremental parse in the Obsidian plugin. A key press in a 1.13 MB note with 3,000 marks takes 12.6 ms (limit 8 ms; design D10 of change 2). Parse only the changed paragraphs, or move the parse off the key press. | 7 (live tracking parses on each key press too) | open |

## Follow-ups from change 3

The explore session and the review of `add-claude-suggest-loop` found these points. They are not in change 3. Each one names the change that takes it. The rows of change 1 that change 3 takes (A, B and D) are set to "done in 3"; C (CJK word boundaries) stays open for change 7.

| Follow-up | Take in | State |
|---|---|---|
| `get_inbox` of the initial plan is replaced by `get_digest`. | — | decided |
| A warning for notes with open marks (other readers of the `.md` files, for example docs builds, see the raw marks). | 6 | open |
| Log rotation or a log index, when a real vault shows a need (now the digest reads the whole log; 1 MB is about 10 ms). | later | open |
| An Obsidian command that starts the co-editor. | 11 | open |
| An optional line range for `read_note` (`fromLine`, `toLine`) for big notes. It does not break the tool shape. | later | open |
| More protected zones: link targets `](...)`, math `$…$` and `$$` blocks, `%%comments%%`, footnote refs `[^1]`, block ids `^abc`, inline HTML. | 14 (`add-more-protected-zones`, before 13) | open |
| Known gaps of the pull digest: Esc while the hook runs loses that digest; a subagent that calls `get_digest` takes the decisions away from the main agent. | 4 (push), or later | open |
| The digest lists only decisions on marks that the agent suggested. Decisions on marks typed by hand stay in the log. | — | decided |
| `--continue` and `--resume` start a new launcher run, so a new session without backlog: decisions made between the end of a conversation and its resume are in no digest. Map the Claude conversation to its co-editor session (the launcher, or the hook, which knows Claude's `session_id` and `COEDIT_SESSION`) and reuse that cursor. | 15 (`add-session-continuity`) | open |
| A stable machine name on macOS (`os.hostname()` can change with DHCP; for example use `scutil --get LocalHostName`). From the apply review. | 15 | open |
| The cursor race between two processes (hook and bridge move one cursor at the same time; worst case one digest twice). A lock file can close it. | 15 | open |
| Multi-line suggestions (new paragraphs, headings). | 13 (`add-multiline-suggestions`) | open |

## Parallel work

Changes that do not share capabilities can run at the same time on separate branches. Changes that share a capability need an agreed archive order (see the Capabilities table). Examples:

- Slice 2: 15 runs in parallel to 14 and 13. Both 13 and 15 can modify `context-digest`, but probably different requirements (13: the digest content; 15: sessions and cursors). When you write the second proposal, check which requirements the first one modifies.
- 16 can run at any time after 3. It shares `event-log` and `context-digest` with other changes.
- Spikes S1 and S2 can run at any time. Start S2 during slice 3, so that slice 4 does not wait.

## Spikes

Spikes stay outside OpenSpec in `spikes/`, as throwaway code.

| Spike | Question | Needed by | Status |
|---|---|---|---|
| S1 | Live tracking in Live Preview: boundary typing, undo and redo, paste, structural edits, IME, Vim mode, auto-pair. If it fails: shadow diff. Also: does an overwrite become a substitution `{~~…~>…~~}` or a deletion and an insertion? | 7 | not started |
| S2 | Custom channel: a click in Obsidian becomes an event in the interactive `claude` session. Which channel flag value works for each load method. | 4 | not started |
| S3 | Codex push | — | deferred: no access to Codex |

## Open checks

| Check | Where |
|---|---|
| Which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`). | S2 |
| Everything works on Windows. There is no Windows machine here. Not done for change 2 (`add-obsidian-review-basics`, task 11.6 open at archive) and change 3 (task 12.6; the checks are in [windows-check-list.md](windows-check-list.md)). The tool to close it: the e2e tests of change 12 (`pnpm test:e2e` on a Windows machine), plus the manual list in [testing.md](testing.md). | Manual, by the user |
| The e2e tests (`pnpm test:e2e`) run on Windows. Change 12 runs them on macOS and on Linux in Docker (`pnpm test:e2e:docker`). | User's Windows machine, or a later CI change |
| Structural edits, IME, Vim mode and auto-pair in live tracking. | S1 |

### Closed checks

| Check | Result | Closed in |
|---|---|---|
| The mark dialect (attribute prefix in the braces) works with existing Obsidian CriticMarkup plugins. | Yes. Keep the attribute prefix. It is exactly the obsidian-track-changes format after two fixes: no `{` or `}` in values, and a tab may separate attributes. The other plugins (review-comments, review-critics, Inkling, Commentator) show our marks as plain text. The note is not damaged. | Change 2 (2026-10-24) |
| A plugin with `defaultEnabled: false` stays off at user scope, and `--settings` switches it on for one session (marketplace id and `@inline`). | Yes (facts F1, F2). `--settings <file>` with `enabledPlugins` switches the plugin on for one session; a plain `claude` has no co-editor tools (manual check 12.3). Confirmed in apply (claude 2.1.310). | Change 3 (2026-10-25) |
| The esbuild ESM bundle of the MCP SDK runs. | Yes (fact F6). The bundle runs alone: the plugin-folder-alone test passes. | Change 3 (2026-10-25) |
| Which `Origin` and `Host` headers Node's global `WebSocket` sends. | No `Origin`; `Host` is `127.0.0.1:<port>`. The rule "refuse every Origin" stays (task 4.2). | Change 3 (2026-10-25) |
| The JSON shape of `claude plugin list --json`. | A JSON array; each entry has `id`, `version`, `scope`, `enabled`, `installPath` (design Open Questions). Fixture `packages/bridge/test/fixtures/plugin-list.json` (task 8.3). | Change 3 (2026-10-25) |
| `/clear` keeps the launcher's session (`COEDIT_SESSION`) inside one run; `--continue` and `--resume` too? | `/clear`: yes (digest once). `--continue` and `--resume` work, but each is a new launcher run, so a new session and a new `coedit-XXXX` folder (expected). Decisions made between the end of a conversation and its resume are in no digest. Follow-up: see "Follow-ups from change 3" (task 12.5). | Change 3 (2026-10-25) |
| `.mcp.json` `env` reaches the MCP server with `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`. | Yes. `COEDIT_VAULT` and `COEDIT_SESSION` arrive (task 12.5). | Change 3 (2026-10-25) |
| `claude plugin install` switches the plugin on at user scope, or not. | Not. Scope `user`, `enabled: false`; a plain `claude` stays without co-editor tools (task 12.3). | Change 3 (2026-10-25) |
| Obsidian fires a `rename` event for each note when a folder is renamed. | One event for the folder first (files still at the old paths), then one for each file. The plugin ignores folder events (task 10.3). | Change 3 (2026-10-25) |

## Capabilities

The spec folders and the changes that touch them. Planned changes are expected values.

| Capability | Main spec exists | Changes |
|---|---|---|
| `coedit-cli` | yes | 0, 3, 8, 15 |
| `markup-format` | yes | 1, 2, 3, 5, 6, 7, 8, 9, 13, 14 |
| `change-decisions` | yes | 1, 2, 3, 5, 6, 9, 10, 13 |
| `markup-rendering` | yes | 2, 5, 7, 9, 10, 13 |
| `review-panel` | no | 6 (added), 5, 9, 11 |
| `vault-hub` | yes | 3, 4, 6, 11, 13, 16 |
| `event-log` | yes | 3, 8, 9, 15, 16 |
| `agent-tools` | yes | 3, 5, 8, 11, 13 |
| `context-digest` | yes | 3, 4, 5, 6, 9, 11, 13, 15, 16 |
| `claude-plugin` | yes | 3, 4, 11, 15 |
