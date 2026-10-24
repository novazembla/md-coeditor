# Proposal

## Why

Slice 1 is the smallest end-to-end loop: the agent suggests, the user accepts or rejects in Obsidian, and the agent sees the decisions. Each part of this loop reads or writes marks in a note: the Obsidian plugin renders them, the hub writes them, and the decisions change them. So we need one exact definition of the mark format first, as pure functions with unit tests. Then change 2 (`add-obsidian-review-basics`) and change 3 (`add-claude-suggest-loop`) build on the same code and do not each invent their own parser. `packages/format` is empty now.

## What Changes

- Define the MD-Coeditor CriticMarkup dialect for notes: the five CriticMarkup kinds, with an optional attribute prefix inside the braces (`{id="k3f9qz" author="Claude" date="2026-10-24"++new text++}`). Unknown attributes are kept.
- Parse a note into plain text, marks and protected zones, and serialize it back. Parse then serialize gives back the same text, byte for byte.
- Find the protected zones: YAML frontmatter (also after a byte order mark), fenced and indented code blocks, inline code, and tables. Marks are never recognized, created or decided inside them.
- Give the agent view of a note: the text as if all pending marks were accepted, with a map back to note positions. Suggestions are matched in this view, so they match what the agent saw.
- Make suggestions: from a find text and a replace text, make `{--old--}` and/or `{++new++}` marks with new ids, the author and the date. Only the changed words are marked. A replace becomes two marks with their own ids.
- Refuse suggestions that are not safe in slice 1: the find text is not found or not unique in the agent view, it overlaps a pending mark or a protected zone, it contains a line break or markup, it changes a line's block prefix (heading, list or quote markers), or it changes nothing.
- Check each decision outcome of a suggestion (accept all, reject all, and the mixed outcomes). Refuse it when an outcome would change a block prefix, or when the new marks would combine with markup or code already in the note, or an outcome would change other marks or zones.
- The functions that write text report their edits (`from`, `to`, `insert`), so that the plugin can apply them as CodeMirror changes and keep the cursor and the undo history.
- Accept and reject one insertion or deletion mark, addressed by its id. Report the decided mark, so that the hub can log it in change 3.
- Recognize substitution, highlight and comment marks, and keep them as they are. Decisions on these kinds are refused until `add-substitution-and-comments`.
- Give ids to marks that have none, and new ids to duplicate ids (for example after copy and paste).

Not in this change: rendering and commands in Obsidian (change 2), the hub, the event log, rebase of suggestions over concurrent edits, and the MCP tools (change 3), live tracking, substitution and comment decisions, multi-line suggestions.

## Capabilities

### New Capabilities

- `markup-format`: the mark syntax in notes, parse and serialize, protected zones, mark ids, and how a suggestion becomes marks (including the refusals).
- `change-decisions`: what accept and reject do to the text of a note, one mark at a time. Change 2 adds the Obsidian commands for it, change 3 adds the logging.

### Modified Capabilities

None. `coedit-cli` does not change.

## Impact

- Code: `packages/format/src/` (new modules and the public exports in `index.ts`) and `packages/format/test/`. No other package changes. The plugin and the bridge do not use the package yet.
- Change 3: the read tool must show the agent the agent view from `project()`, else the agent's find texts do not match.
- Dependencies: a dev dependency `fast-check` in `packages/format` for property tests (round trip). No runtime dependencies. The package stays free of Obsidian, CodeMirror and Node APIs, so it runs in Electron and in Node.
- Notes on disk: this change fixes the format that users commit to git with their notes. Later changes must stay compatible with it.
- Docs: `openspec/docs/tech-stack.md` gets the `fast-check` entry.
