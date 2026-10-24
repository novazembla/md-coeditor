# Design

## Context

See proposal.md for the why and the decisions made with the user. The current state:

- `packages/format` (change 1) parses notes, finds protected zones, and decides one mark by id (`decide(text, id, decision)`). Writers return `changes` (`from`, `to`, `insert`) in positions of the input text, for CodeMirror. `assignIds` gives ids to all marks without one.
- `packages/obsidian` is an empty `Plugin` with one jsdom smoke test. It does not depend on `@md-coeditor/format` yet.
- Obsidian 1.14.4 ships `@codemirror/state` 6.7.6 and `@codemirror/view` 6.43.13 (the catalog pins the same versions). `@codemirror/commands` is not a peer of `obsidian`, so the plugin must not import it at runtime.
- The `obsidian` npm package has types only, no runtime code. Code that imports `obsidian` cannot run in vitest.

## Goals / Non-Goals

**Goals:**
- All editor logic is plain CodeMirror 6 code that runs in jsdom tests. `main.ts` only wires it to Obsidian.
- One mark parser: the plugin calls `packages/format` and never matches mark syntax itself, also in Reading view.
- The format API is final enough that change 3 (the hub) can build on it without another breaking change.

**Non-Goals:**
- No cache or incremental parse, unless the measurement (D10) shows a need.
- No decisions on a selection that covers more than one mark ("accept all in the selection"). That comes with the review panel (change 6).
- No tracking of the user's typing (change 7). Typing at the edge of a mark goes where CodeMirror puts the cursor (see Risks).

## Decisions

### D1. Modules in `packages/obsidian/src`

| Module | Content | Imports `obsidian`? |
|---|---|---|
| `marks.ts` | `StateField` with the parse result of the document (insertions and deletions, with their hidden ranges and visible ranges). Recomputed when the document changes. | no |
| `render.ts` | Decorations and atomic ranges from the field; theme classes; tooltip text. | no |
| `protect.ts` | The change filter (D5) and the Backspace/Delete keymap (D5). | no |
| `decide.ts` | `markAt(state, pos)`, `decideAt(state, pos, decision)` → a `TransactionSpec` or a notice text. | no |
| `navigate.ts` | `nextChange(state, dir)` → a selection, or a notice text. | no |
| `reading.ts` | `renderChanges(el: HTMLElement)` for Reading view (D8). | no |
| `extension.ts` | `coeditExtension({ isLivePreview })`: all of the above as one CodeMirror extension. | no |
| `main.ts` | `registerEditorExtension`, commands, `editor-menu`, `registerMarkdownPostProcessor`, `Notice`. | yes |

`isLivePreview: (state) => boolean` is a parameter, because `editorLivePreviewField` comes from `obsidian`. `main.ts` passes `(s) => s.field(editorLivePreviewField, false) ?? false`. Tests pass `() => true` or `() => false`.

Alternative: one `main.ts` with everything. Rejected: nothing could be tested without Obsidian.

### D2. One state field, decorations from it

The field holds, for each insertion and deletion outside protected zones: `start`, `end`, `contentStart`, `contentEnd`, `kind`, `id`, `author`, `date`. The hidden ranges are `[start, contentStart)` (brace, attributes, operator) and `[contentEnd, end)` (operator, brace). The field recomputes on each `docChanged` with `parse(doc.toString())`.

Decorations (`EditorView.decorations.compute([field, livePreview])`), only when `isLivePreview(state)` is true:
- `Decoration.replace({})` on each hidden range. Hidden ranges never contain a line break (an attribute value has none, operators have none), so replace decorations stay on one line.
- `Decoration.mark({ class: "coedit-ins" | "coedit-del", attributes: { "aria-label": tooltip } })` on the content. A mark decoration may cross a line break.
- `EditorView.atomicRanges` with the same hidden ranges, so cursor motion skips them (spec "The cursor never stops inside hidden syntax").

Obsidian shows a styled tooltip for elements with `aria-label`, and screen readers read it. Tooltip text: `author, date`, or `Unknown author`, without the date when there is none.

Alternative: a `ViewPlugin` that parses only the visible ranges. Rejected: marks are found by a scan from the start of the note (zones, inline code), so a part of the note cannot be parsed alone.

Alternative: CodeMirror `hoverTooltip`. Rejected for now: more code, and Obsidian's `aria-label` tooltip looks like the rest of the app.

### D3. Styles

`styles.css` defines `.coedit-ins` (Obsidian variable `--color-green`, underline) and `.coedit-del` (`--color-red`, `line-through`). The same classes are used in Live Preview and in Reading view. Theme variables keep the colours readable in light and dark themes. Colours for each author are change 10.

### D4. Live Preview only

The decorations, the commands and the menu items check `isLivePreview`. In Source mode, the field is still computed (cheap), but it gives no decorations and no atomic ranges, so the raw text shows and the cursor moves normally. The commands use `editorCheckCallback` and return `false` when the editor is not in Live Preview, so Obsidian does not list them.

### D5. Keeping the mark syntax whole

Two parts:

1. **Change filter** (`EditorState.changeFilter`). It applies only to user edits: `tr.isUserEvent("input")`, `"delete"`, `"move"` (drag) and `"paste"` (part of `input`). For each mark that a change overlaps (`from < markEnd && to > markStart`) but does not cover fully, it returns the hidden ranges of that mark as suppressed ranges. CodeMirror then applies the change only outside those ranges. Pure insertions (`from === to`) never overlap. Changes from Obsidian itself (file reload, sync) and decisions are not user events, so they pass.
2. **Backspace and Delete keymap** (`Prec.high`). With an empty selection directly after a hidden range (Backspace) or directly before one (Delete), the key deletes the visible character on the other side of the hidden range. Without it, CodeMirror deletes the whole atomic range, and the filter then suppresses that, so the key would do nothing.

Decisions use `filter: false` in the transaction spec, so the filter never touches them.

Alternative: no protection; a broken mark shows as raw text, and the user can undo. Rejected: with hidden syntax, the user cannot see what they broke.

Alternative: a `transactionFilter` that rewrites the changes. Rejected: `changeFilter` does the same with suppressed ranges, and CodeMirror maps the selection.

### D6. Deciding the mark at a position

`markAt(state, pos)` finds insertions and deletions with `start <= pos <= end`. Positions inside a hidden range cannot occur (atomic ranges), so `pos` is in the content or at an outer edge. When two marks touch `pos`, it takes the mark whose visible text starts at `pos`: that is `contentStart === pos`, or `start === pos`. So after a deletion is decided, the cursor sits before the insertion of the same replace, and the next "Accept change" decides the insertion (spec scenario "Decide both marks of a replace one after the other").

`decideAt(state, pos, decision)`:
1. No mark: notice `No change at the cursor.` A substitution, highlight or comment at `pos` (from the parse result): notice `Not supported yet: <kind>.`
2. If the mark has no id or a duplicate id: `ensureId(text, mark.start)` (D9) gives `text1`, `changes1` and the new id.
3. `decide({ text: text1, id, decision })` gives `changes2`.
4. Compose: `ChangeSet.of(changes1, len0).compose(ChangeSet.of(changes2, len1))`, and dispatch one transaction with `filter: false`, `userEvent: "coedit.decide"`, and the selection mapped to the start of the decided range. One transaction is one undo step. Undo gives back the text before step 2, so the id never stays in the file without a decision (decision 3 in the proposal).

The decision result (mark, decision, id) is returned to the caller too. Change 3 sends it to the hub log. In this change, nothing uses it.

### D7. Commands and the menu

`main.ts` adds the commands `accept-change`, `reject-change`, `next-change` and `previous-change`, with no default hotkeys (Obsidian's guideline: users set hotkeys). Names: "Accept change", "Reject change", "Go to next change", "Go to previous change".

The editor menu (`workspace.on("editor-menu")`) does not give the mouse position. A `contextmenu` DOM handler (`EditorView.domEventHandlers`) stores `view.posAtCoords(event)` in a small `StateField` before Obsidian opens the menu. The `editor-menu` handler reads that position and adds the two items only when `markAt` finds an insertion or deletion. The order of the two events must be checked in the real app (manual task).

### D8. Reading view

`registerMarkdownPostProcessor` runs `renderChanges(el)` on each rendered section:

1. Collect the text nodes of `el` in document order, but skip `code`, `pre`, `table` and frontmatter elements (the protected zones as rendered HTML).
2. Join their text and `parse` it. The joined text is the rendered text, so formatting syntax is gone (`**bold**` is the text `bold` in a `strong`). A mark whose open and close sequences are in text nodes of the same section is found.
3. For each insertion and deletion, remove the hidden ranges from the text nodes, and wrap each text-node part of the content in `span.coedit-ins` or `span.coedit-del` with the `aria-label`. Content across a `strong` gives two or more spans.

Reading view has no editor, so no menu items and no commands act there (spec "Reading view has no decisions").

Alternative: render the section again from the source (`ctx.getSectionInfo`). Rejected: it repeats Obsidian's Markdown rendering.

### D9. Format library changes

| Item | Decision |
|---|---|
| `Mark` type | A readonly union with one shape per kind: `InsertionMark`, `DeletionMark`, `SubstitutionMark` (with `oldContent`, `newContent`), `HighlightMark`, `CommentMark`. Common fields in a base interface. `kind` is the discriminant. |
| `serialize` | Keep it. The spec "Lossless round trip" names it, and the round-trip tests use it. Its comment says that it is a check function and gives back the parsed text. |
| `decide` | Takes one input object: `decide({ text, id, decision })`, like `suggest`. |
| `Result<T>` | `T` may not have the keys `ok`, `code` or `message` (a type constraint), so success fields cannot collide with error fields. |
| `date` check | `suggest` checks that the date is a real calendar date (spec "Suggestion date is a calendar date"). Parse stays lenient. |
| Attributes | `readAttrs` accepts spaces and tabs between attributes, and refuses a value with `{` or `}` (spec "Mark attributes"). `suggest` refuses an author with `{` or `}` as `invalid_attribute`. `writeAttrs` still writes one space. |
| `ensureId` | New: `ensureId(text, at, options?)` gives a new id to the one mark that starts at `at`, if it has no id or a duplicate id. It returns `{ text, changes, id }` and changes no other mark. Same id rules as `assignIds` (D5 of change 1). |

### D10. Speed

The field parses the full note on each change. Change 1 measured about 3 ms for 3,000 marks. This change measures, in Node, the parse and the decoration build for a note of 1 MB with 3,000 marks. The limit is 8 ms for both (half a frame at 60 Hz). Above the limit: write down the result and add a roadmap follow-up for an incremental parse. No cache in this change.

### D11. Documentation

- `roadmap.md`: close the dialect open check with the research result; add the follow-up "Read Commentator's `{"author":"X"}@@` data as attributes" for change 9; add `markup-format` to the capabilities of change 2 (also in the Capabilities table); set the status of change 2.
- `architecture.md`, "Mark format": the dialect is the obsidian-track-changes format; a short compatibility note; remove the open decision.
- `tech-stack.md`: Live Preview logic is plain CodeMirror code with an injected `isLivePreview`, because `obsidian` has no runtime code in tests.

## Risks / Trade-offs

- [Typing at the edge of a mark: the positions before `{` and after the prefix look the same, so typed text can land inside or outside the insertion] → Accepted for change 2. Live tracking (change 7, spike S1) defines boundary typing.
- [Obsidian's Markdown highlighting sees the hidden attribute text, for example an `_` in `author="my_name"` could start emphasis that ends later in the line] → The values are hidden, but the emphasis could leak. Add a test note with `_` and `*` in values to the manual tests. If it leaks, escape is not possible (the format is fixed), so we add a CSS reset inside hidden ranges or accept it.
- [The history undo of a decision: CodeMirror's undo transaction is not created with `filter: false`] → Undo replaces plain text with the old mark text; that change overlaps no existing mark syntax, so the filter does not act. A test checks undo and redo of both decisions.
- [Reading view: a backslash-escaped backtick shows as a plain backtick, and `parse` can read it as the start of inline code] → Rare. A mark after it then shows raw. Known gap, like the escaped-backtick follow-up.
- [The `contextmenu` and `editor-menu` order can change in a later Obsidian version] → Manual test; fall back to the cursor position if no stored position exists.
- [The full parse on each key press in very large notes] → D10 measures it.
- [Changing `decide` and `Mark` breaks callers] → Only the format tests call them now.

## Migration Plan

None. No notes with MD-Coeditor marks exist yet. A mark whose attribute value contains `{` or `}` is no longer a mark after this change; such marks are not known to exist.

## Tests

- **Format unit and spec tests** (`packages/format/test`): new rows in the attribute table (tab, `{`, `}`), the calendar check (table of dates: `2026-02-30`, `2026-02-29`, `2028-02-29`, `2026-13-01`, `2026-04-31`), `ensureId` (no id, duplicate, has id: no change, other marks unchanged), the `decide` input object. Update `markup-format.spec.test.ts` with one test per new or modified scenario.
- **Property tests** (fast-check, existing generators): `ensureId` then `decide` gives the same text as `decide` on a note where that mark already had the id; `ensureId` changes only the prefix of one mark; the round trip still holds with tabs in prefixes.
- **CodeMirror tests** (`packages/obsidian/src`, vitest + jsdom): an `EditorView` with `coeditExtension({ isLivePreview: () => true })`.
  - Rendering: `contentDOM.textContent` per line, the classes and `aria-label` of the content spans, the atomic ranges.
  - Edits: dispatch transactions with `userEvent` `"input.type"`, `"delete.backward"` and `"input.paste"`, and run the keymap handlers, then compare the document text.
  - Decisions and navigation: call `decideAt` and `nextChange` on states, dispatch, compare text and selection; undo and redo with CodeMirror's history state from `@codemirror/commands`, added as a devDependency in a version that works with the pinned `@codemirror/state` (tests only, never imported by the plugin code).
  - Source mode: the same tests with `isLivePreview: () => false` show raw text.
- **Reading view tests**: `renderChanges` on jsdom elements that copy Obsidian's rendered HTML (a paragraph with `strong`, inline `code`, a table).
- **Spec tests**: `packages/obsidian/src/markup-rendering.spec.test.ts` and `packages/obsidian/src/change-decisions.spec.test.ts`, one test per scenario, named after it. Scenarios that need the Obsidian app (right-click menu, command palette, file reload, hover tooltip display, notices) are `test.todo` with a pointer to the manual test.
- **Measurement**: a vitest bench or a script for D10, run on demand, not in `pnpm check`.
- **Manual tests** in `test-vault/` with a note that has all cases: insertions, deletions, a replace, marks without ids, a duplicate id, marks in code and tables, a substitution, a mark over two lines, `_` and `*` in attribute values, formatting inside a mark. Check: Live Preview, Source mode, Reading view, commands, menu, hotkeys, undo, notices, file reload from disk, light and dark theme.

## Open Questions

- Does `EditorState.changeFilter` with suppressed ranges also keep the selection correct after a paste over part of a mark? The edit tests answer it. If not, the plugin sets the selection after such a transaction itself (a `transactionExtender`). This does not change the specs or the approach.
