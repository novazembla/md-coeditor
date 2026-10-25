# MD-Coeditor architecture: mark format

Part of the architecture. The entry point is [architecture.md](architecture.md). The Obsidian side is in [architecture-obsidian.md](architecture-obsidian.md), the Claude side in [architecture-claude.md](architecture-claude.md).

`packages/format` owns the mark format. The editor and the hub in the Obsidian plugin use it and do not parse marks themselves. The bridge does not parse marks: the digest and `get_detail` use the mark content that the log holds. Users commit notes in this format, so later changes must stay compatible with it. The details are in the specs `markup-format` and `change-decisions`.

## Data flow

All functions take the note text and give back data. The callers apply the returned `changes`.

```mermaid
flowchart LR
  TEXT["Note text<br/>(string)"]

  subgraph FMT["packages/format (pure functions)"]
    direction TB
    PARSE["parse()<br/>marks + protected zones"]
    PROJECT["project()<br/>agent view + position map"]
    SUGGEST["suggest()<br/>find / replace to marks"]
    DECIDE["decide()<br/>accept / reject one mark"]
    IDS["assignIds()<br/>new and duplicate ids"]
    SER["serialize()"]
  end

  TEXT --> PARSE
  TEXT --> PROJECT
  TEXT --> SUGGEST
  TEXT --> DECIDE
  TEXT --> IDS
  PARSE --> SER

  PROJECT -->|"agent view text"| AGENT["Hub: read_note,<br/>get_context selection<br/>(change 3)"]
  SUGGEST -->|"Result: text, changes, marks<br/>or code, message, details"| HUB["Hub: suggest_edit<br/>(change 3)"]
  DECIDE -->|"Result: text, changes"| EDITOR["Editor decision<br/>(change 2)"]
  IDS -->|"changes"| EDITOR
  PARSE -->|"marks"| RENDER["Editor rendering<br/>(change 2)"]
```

## Dialect

The dialect is the obsidian-track-changes format. We checked it against the other Obsidian CriticMarkup plugins on 2026-10-24.

- The five CriticMarkup kinds: `{++insertion++}`, `{--deletion--}`, `{~~old~>new~~}`, `{==highlight==}`, `{>>comment<<}`.
- An optional attribute prefix inside the braces: `{id="k3f9qz" author="Claude" date="2026-10-24"++new++}`. New marks write `id`, `author`, `date` in this order. Unknown attributes are kept, in their order. This is the extension point for later attributes.
- Attribute rules: spaces or tabs separate the attributes. A value has no `"`, `{`, `}` or line break. A `date` is a real calendar date.
- Compatibility: the obsidian-track-changes plugin reads our marks, with author and date. The plugins review-comments, review-critics, Inkling and Commentator show our marks as plain text. They do not damage the note. Commentator writes its data as `{++{"author":"X"}@@x++}`. We read that data as content for now. A follow-up in `add-external-changes` fixes this (see [roadmap.md](roadmap.md#follow-ups-from-change-1)).
- A mark ends at the first close sequence of its kind. A mark can contain a single line break, but no blank line.
- Considered and rejected: the attributes in an HTML comment after the mark (`{++x++}<!--id="a1"-->`). Plain CriticMarkup tools would show a clean mark, but an edit can separate the comment from its mark. Only `attrs.ts`, `parse.ts` and `serialize.ts` know the prefix.

## Protected zones

Marks are never recognized, created or decided inside a protected zone, and a mark never crosses a block zone. A suggestion whose match touches a zone is refused with `protected_zone`. The zone rules are simple approximations of CommonMark and Obsidian, not a full parser.

| Zone kind | What it is |
|---|---|
| `frontmatter` | YAML frontmatter at the start of the note, also after a byte order mark |
| `fenced-code` | A fenced code block (backticks or tildes) |
| `indented-code` | An indented code block (4 or more columns) |
| `table` | A line with a pipe, directly followed by a delimiter row, and the rows after it |
| `inline-code` | A code span: a backtick run up to the next run of the same length |
| `wikilink` | `[[...]]` or an embed `![[...]]`, up to the next `]]` on the same line (change 3) |
| `callout-marker` | `[!type]` with an optional `+` or `-`, directly after a quote prefix (`>` with optional spaces, also nested `> >`) (change 3) |

Inline code follows the CommonMark rule for backslashes (change 3): a backtick run after an odd number of backslashes does not open a code span. Inside a code span, a backslash is a normal character, so `` `C:\` `` is a closed code span.

Known gaps, as roadmap follow-ups: link targets `](...)`, math `$…$` and `$$` blocks, `%%comments%%`, footnote refs `[^1]`, block ids `^abc` and inline HTML. CJK word boundaries are open for change 7: a word is a run of non-whitespace, so one changed CJK character marks the whole run.

## Ids

Each mark that MD-Coeditor creates gets a random 6-character id (`[a-z0-9]`). Ids are not counters, because the event log keeps old ids after their marks leave the note. `assignIds` gives ids to marks without one and to duplicates (for example after copy and paste). It changes only the prefix.

## Rules for the format library

- **Pure functions.** Text in, data out. No I/O, no clock, no global state. No imports from Obsidian, CodeMirror, Node or the DOM, so it runs in Electron and in Node.
- **Lossless.** Parse never normalizes. Parse and serialize give back the same text, byte for byte (CRLF, non-ASCII, malformed marks).
- **Positions are UTF-16 code units**, the same as JavaScript string indices and CodeMirror positions. Nothing may split a surrogate pair (an emoji).
- **Writers report edits.** `suggest`, `decide` and `assignIds` return `changes` (`from`, `to`, `insert`, in positions of the input text) and the new text. The plugin applies `changes` as one CodeMirror transaction, so the cursor and the undo history survive.
- **Functions take text, not a parse result.** A caller cannot pass a stale parse.
- **Refusals are results, not exceptions.** Each has a code, a short English message that the hub can give to the agent as it is, and sometimes details (see [Refusals](#refusals)). Exceptions are only for programming errors.

## Refusals

A refusal is `{ ok: false, code, message, details? }`. Each function has its own code union: `SuggestErrorCode` for `suggest` and `DecideErrorCode` for `decide` (`not_found`, `duplicate_id`, `unsupported_kind`). `ErrorCode` is the union of both, for callers that do not care. The hub passes code, message and details to the agent unchanged, and `packages/protocol` lists the same codes as strings.

| Code | `details` |
|---|---|
| `ambiguous` | `{ matches }`: the number of matches |
| `protected_zone` | `{ zone }`: the kind of the first zone that a match touches |
| `overlaps_mark` | `{ ids }`: the ids of the pending marks that the match touches |

## Agent view

The agent view is the note as if all pending marks were accepted: insertions, highlights and the new text of substitutions show; deletions and comments are hidden. `project()` makes it, with a map back to note positions.

- The agent reads notes in the agent view (`read_note`), and `suggest` matches the find text in the same view. So matches fit what the agent saw. The selection of `get_context` and the mark lines of `read_note` are in view coordinates too.
- `before` and `after` are optional texts right before and after `find`. They pick one place when `find` occurs more than once.
- Matches that touch a pending mark count. If the agent sees the text two times, the result is `ambiguous`, never a silent choice. Matches in protected zones do not count.
- A match that touches a pending mark is refused with `overlaps_mark`. A match next to a mark is fine.

In the example, the note has a pending replace. The agent finds `brown fox`, which does not touch the mark, so `suggest` makes new marks. A find text `slow brown` would touch the pending insertion and get `overlaps_mark`.

```mermaid
flowchart LR
  NOTE["Note<br/>The {--quick--}{++slow++} brown fox"] -->|"project()"| VIEW["Agent view<br/>The slow brown fox"]
  VIEW -->|"agent: find 'brown fox'"| MATCH["One match in the view,<br/>touches no pending mark"]
  MATCH -->|"position map"| POS["Positions in the note,<br/>after the insertion"]
  POS -->|"suggest()"| OUT["New marks"]
  VIEW -->|"agent: find 'slow brown'"| OVL["overlaps_mark,<br/>details: ids of the insertion"]
```

## Suggestions are safe in every outcome

A suggestion becomes a deletion and an insertion, each with its own id and decision. Only the changed words are marked. Before `suggest` writes, it checks the marked text and every decision outcome (accept all, reject all, and both mixed outcomes):

- No other mark is lost, joined or added, and the protected zones stay the same. Else: `unsafe_result`.
- The block structure of the line stays the same: block prefix (heading, list, task and quote markers, indentation of 4 or more columns), setext underline, thematic break. Else: `structural_edit`.

So a decision in Obsidian can never break the note or hide other pending marks. Slice 1 suggestions are one line each, with no markup in the find or replace text.

```mermaid
flowchart TD
  IN["suggest(text, find, replace,<br/>before?, after?, author, date)"] --> V{"Input valid?<br/>not empty, one line,<br/>no markup, valid attributes"}
  V -->|no| E1["empty_find, no_change,<br/>line_break, markup_in_text,<br/>invalid_attribute"]
  V -->|yes| M{"Matches in the agent view<br/>(with before and after),<br/>outside protected zones"}
  M -->|"0, but one in a zone"| E2["protected_zone<br/>details: zone"]
  M -->|"0"| E3["not_found"]
  M -->|"2 or more"| E4["ambiguous<br/>details: matches"]
  M -->|"1"| Z{"Overlaps a<br/>pending mark?"}
  Z -->|yes| E5["overlaps_mark<br/>details: ids"]
  Z -->|no| W["Mark only the changed words:<br/>deletion + insertion, new ids"]
  W --> C{"Check 4 outcomes:<br/>accept all, reject all,<br/>2 mixed"}
  C -->|"block structure changes"| E6["structural_edit"]
  C -->|"other marks or zones change"| E7["unsafe_result"]
  C -->|ok| OK["ok: text, changes, marks"]
```
