# Proposal

## Why

The vision promises "a review model that people know": suggestions show inline in the note, where the user reads, and the user decides about each change, as in Word. Change 1 (`add-insert-delete-format`) defined the marks and what accept and reject do to the text, but nothing in Obsidian shows or decides them yet. The Obsidian plugin is an empty scaffold. Change 3 (`add-claude-suggest-loop`) needs a place where the agent's suggestions appear and where the user decides, so this change comes first. It works without an agent: it also shows marks that are already in a note, from earlier sessions or from other tools.

The mark format is committed into users' notes, so this is also the last cheap moment to fix it. The roadmap's open check "the mark dialect works with existing Obsidian CriticMarkup plugins" is now answered (see the research summary below).

## What Changes

- **Rendering in Live Preview.** Insertions show green and underlined, deletions red and struck through (one fixed pair of colours; colours for each author come later). The CriticMarkup syntax and the attribute prefix are always hidden, also when the cursor is inside a mark. The cursor moves over the hidden parts as one step. Author and date show in a tooltip on hover.
- **Rendering in Reading view.** Insertions and deletions show with the same styles. Reading view only shows the current state: no accept or reject there.
- **Source mode** shows the raw text, as it is in the file.
- **Typing inside a mark** changes its content. There is no tracking of the user's own typing yet (that is `add-live-tracking`).
- **Accept and reject in Live Preview**, for the insertion or deletion at the cursor:
  - commands "Accept change" and "Reject change" (the user can give them hotkeys)
  - "Accept change" and "Reject change" in the editor's right-click menu
  - each decision is one editor transaction, so one undo step reverts it
- **Commands "Go to next change" and "Go to previous change"** move the cursor to the next or previous insertion or deletion.
- **Marks without an id** (typed by hand, pasted, or written by another tool) get an id at the moment the user accepts or rejects them, in the same transaction. Opening a note never changes it.
- **Other kinds** (substitution, highlight, comment) keep their current look until `add-substitution-and-comments`. Accept or reject on them shows the notice "Not supported yet" and does not change the note.
- **Mark dialect: keep the attribute prefix,** with two fixes so that it is exactly the format of the obsidian-track-changes plugin:
  - an attribute value must not contain `{` or `}`
  - a tab may separate attributes, as well as a space
- **Format library clean-up** (roadmap follow-ups that must land before the plugin depends on the API): a readonly `Mark` type with one shape per kind, a decision about `serialize`, `decide` takes one input object, `Result` keys cannot collide with result fields, and `date` gets a calendar check (`2026-02-30` is not valid).

Research summary for the dialect (2026-10-24, from the parser source of each plugin):

| Plugin | Downloads | Its metadata syntax | Our marks in that plugin |
|---|---|---|---|
| obsidian-track-changes | 3,378 | `{author="X" date="D"++x++}` | read correctly, with author and date |
| review-comments | 2,789 | `{>>id\|author\|date\|TYPE: x<<}` | plain text |
| review-critics | 2,040 | `{>>[author=X] x<<}` | plain text |
| Inkling | 204 | JSON + `@@`, or `{++x++}{author="X"}` | plain text |
| Commentator | not in the store | `{++{"author":"X"}@@x++}` | plain text |

No other format has a wider use or a real attribute grammar. "Plain text" means the raw mark is readable, and the note is not damaged.

Not in this change: the review panel, accept all and reject all (`add-review-panel`), the floating toolbar, colours for each author and display modes (`add-editor-toolbars-and-display-modes`), live tracking (`add-live-tracking`), decisions on substitutions and comment threads (`add-substitution-and-comments`), the hub, the event log and the agent (`add-claude-suggest-loop`).

## Capabilities

### New Capabilities

- `markup-rendering`: how marks look in Obsidian (Live Preview, Reading view, Source mode), the hidden syntax, the tooltip, and the commands that move between changes.

### Modified Capabilities

- `change-decisions`: the user accepts and rejects the mark at the cursor in Live Preview, through commands and the right-click menu; a mark without an id gets an id in the same step; a decision is one undo step; decisions on unsupported kinds show a notice and do not change the note.
- `markup-format`: attribute values must not contain `{` or `}`; a tab is a valid separator between attributes; a `date` must be a real calendar date.

## Impact

- **Code:** `packages/obsidian/src/` (CodeMirror 6 extension, Reading view post-processor, commands, context menu), `packages/obsidian/styles.css`, and tests in `packages/obsidian`. `packages/format/src/` for the dialect fixes and the API clean-up. Its callers are only its own tests for now.
- **Notes on disk:** a mark whose attribute value contains `{` or `}` is no longer a mark. No notes with MD-Coeditor marks exist yet, so nothing must migrate.
- **Performance:** the plugin parses the whole note on each change. Measure this on a large note (thousands of marks) before adding a cache.
- **Known gap:** Commentator stores data as `{++{"author":"X"}@@x++}`. Our parser reads `{"author":"X"}@@` as content, so accepting such a mark puts that text into the note. This is a follow-up for `add-external-changes` (text from other tools).
- **Docs:**
  - `openspec/docs/roadmap.md`: close the open check on the mark dialect with the research result; add the Commentator follow-up for change 9; add `markup-format` to the capabilities of change 2; update the status of change 2.
  - `openspec/docs/architecture.md`, Mark format: name the dialect "the obsidian-track-changes format", add the compatibility result, and remove the open decision on the dialect.
  - `openspec/docs/initial-plan.md` (frozen) and the archived change 1 design stay as they are.
