# Design

## Context

`packages/format` exists and is empty (`src/index.ts` exports nothing). It is an internal package: `private`, it exports TypeScript source, it has no build step, and its `tsconfig.json` has `lib: ES2022` and `types: []` (no DOM, no Node types). vitest finds it through the root `test.projects`. See proposal.md for the motivation, and the two specs for the required behavior.

Users of the package in later changes:

- change 2: the Obsidian plugin parses the note to render marks, and calls accept and reject.
- change 3: the hub calls suggest for `suggest_edit`, and logs the decision results.

Both run in Electron or Node, and both work with CodeMirror positions (UTF-16 offsets).

## Goals / Non-Goals

**Goals:**

- One parser that every later change uses. It is pure: input text, output data. No I/O, no clock, no global state.
- Simple rules for the approximations of Markdown (zones, block prefix). We do not want a full CommonMark parser.
- Results and errors that the hub can map directly to MCP tool results.

**Non-Goals:**

- Incremental parsing. We parse the full note each time. Notes are small, and change 2 can measure this.
- A Markdown AST. The format knows only marks, zones and line prefixes.
- Obsidian-specific syntax as zones: `%%comments%%`, `$$math$$`, HTML blocks, callout bodies. See Risks.

## Decisions

### D1. Modules and public API

```
packages/format/src/
├── index.ts      # public exports only
├── types.ts      # Mark, Zone, ParsedNote, Result, error codes
├── zones.ts      # block zones (line-based)
├── parse.ts      # inline scan: marks and inline code; parse()
├── attrs.ts      # attribute prefix: read and write
├── serialize.ts  # serialize(), writeMark()
├── ids.ts        # newId(), assignIds()
├── project.ts    # project(): the agent view
├── suggest.ts    # suggest()
└── decide.ts     # decide()
```

Public functions:

| Function | Result |
|---|---|
| `parse(text)` | `ParsedNote`: `segments` (text and mark segments in order), `marks`, `zones`, `duplicateIds` |
| `serialize(parsed)` | the text |
| `project(text)` | `View`: the agent view text, and a map from view positions to note positions |
| `suggest(text, { find, replace, before?, after?, author, date, newId? })` | `Result<{ text, changes, marks }>` |
| `decide(text, id, "accept" \| "reject")` | `Result<{ text, changes, mark, decision }>` |
| `assignIds(text, { newId? })` | `{ text, changes, assigned }` |

`suggest`, `decide` and `assignIds` take text, not a `ParsedNote`. They parse it themselves. So a caller cannot pass a stale parse result.

The functions that write text return `changes`: a list of `Change = { from, to, insert }`, with `from` and `to` in positions of the input text, in order, without overlap. They also return the new `text` for convenience. Change 2 dispatches `changes` as one CodeMirror transaction, so the cursor, the undo history and typing during a hub call survive. A later rebase step also needs edits, not full texts.

The **agent view** is the note as if all pending marks were accepted: plain text as it is, the content of insertions and highlights, the new text of substitutions. Deletions and comments are hidden. `View` has the view `text`, and for each mark its range in the view (empty for hidden marks), so that a view position maps back to a note position. The read tool in change 3 shows the agent this view, so that `find` matches what the agent saw.

`Mark`: `kind` (`insertion`, `deletion`, `substitution`, `highlight`, `comment`), `start`, `end`, `attrs` (ordered list of `[name, value]`), `id?`, `author?`, `date?`, `content` (for a substitution: `oldContent` and `newContent`), and `contentStart` and `contentEnd`. `Zone`: `kind` (`frontmatter`, `fenced-code`, `indented-code`, `inline-code`, `table`), `start`, `end`.

### D2. Lossless by construction

Each segment keeps its start and end in the input text. `serialize` joins the input slices of the segments. So the round trip cannot lose text, also for malformed marks, CRLF and non-ASCII text. The parser never normalizes. Only `suggest`, `decide` and `assignIds` write new text, and they change only the ranges they report.

Alternative: rebuild the text from the fields of the marks. Rejected: every spacing detail of the attribute prefix would need its own field.

### D3. Two passes: block zones, then an inline scan

Pass 1 (`zones.ts`) goes line by line and finds the block zones. Lines end with `\n`. A `\r` before it belongs to the line ending. A blank line contains only spaces and tabs.

| Zone | Rule |
|---|---|
| Frontmatter | Line 1 is `---`. It ends at the next line that is `---` or `...`. Without an end line, there is no frontmatter (this is how Obsidian reads it). A byte order mark (`U+FEFF`) at the start of the note is skipped for this test (Windows editors write it). The zone starts after it. |
| Fenced code | A line with up to 3 spaces of indentation, then 3 or more `` ` `` or `~`. It ends at a line with the same character, at least the same count, and only spaces after it. Without an end, it continues to the end of the note. |
| Indented code | A line indented by 4 spaces or a tab, after a blank line or at the start of the note, when the last non-blank line before it is not a list item or a continuation of a list item. Following indented lines and blank lines belong to it. Trailing blank lines do not. |
| Table | A line that contains `\|`, directly followed by a delimiter row (`\|? :?-+:? (\| :?-+:?)* \|?`). Following lines belong to it until a blank line. |

Pass 2 (`parse.ts`) scans the text outside block zones from left to right. At each position, the first construct that starts there wins:

- `` ` ``: a run of n backticks. Look for the next run of exactly n backticks in the same paragraph. If found, the range is an inline-code zone. If not, the backticks are text.
- `{`: try a mark (D4). If it is not valid, `{` is text.

So `` `{++x++}` `` is inline code, and `` {++run `make`++} `` is one insertion. The close search for a mark and for inline code stops at a blank line and at the start of a block zone. This is the CommonMark rule "leftmost first" in a simple form.

Alternative: find inline code first, then marks. Rejected: then inline code inside an insertion breaks the insertion.

### D4. Mark grammar

```
mark      = "{" [ attrs " "* ] op-open content op-close "}"
attrs     = attr *( " "+ attr )
attr      = name '="' value '"'
name      = ALPHA *( ALPHA / DIGIT / "-" / "_" )
value     = *( any char except '"', CR, LF )
```

| Kind | Open | Close | Content |
|---|---|---|---|
| insertion | `{++` | `++}` | to the first `++}` |
| deletion | `{--` | `--}` | to the first `--}` |
| substitution | `{~~` | `~~}` | to the first `~~}`, split at the first `~>`; without `~>` it is not a mark |
| highlight | `{==` | `==}` | to the first `==}` |
| comment | `{>>` | `<<}` | to the first `<<}` |

The first close sequence ends the mark, as in CriticMarkup. So content that ends with the operator character still works: `{++x+++}` has the content `x+`. Content cannot contain a blank line.

Write order for new marks: `id`, `author`, `date`, with one space between them and no space before the operator. `assignIds` changes only the prefix of a mark: it replaces the `id` value, or puts `id="…"` first. Other attributes keep their order and values.

Alternative: attributes in an HTML comment after the mark (`{++x++}<!--id="a1"-->`). Plain CriticMarkup tools would then show a clean mark. Rejected for now: the comment is a separate construct, so a cut, paste or edit can separate it from its mark, and an HTML comment at the start of a line is an HTML block in CommonMark. With the prefix inside the braces, the mark and its id cannot come apart. The dialect is still cheap to change before the first release (only `attrs.ts`, `parse.ts` and `serialize.ts` know it). See Open Questions.

### D5. Ids: random, 6 characters

`newId()` returns 6 characters from `[a-z0-9]` (36^6 ≈ 2·10^9 values). If the id is already in the note or in this call, it makes a new one. Callers can pass their own `newId` (the tests pass a counter).

Alternative: counters per note (`s1`, `s2`, …). Rejected: after an accept, the mark leaves the note, so the next counter value can be the same as an old id. Then the log in change 3 has two meanings for one id. The format cannot see the log. Random ids do not need the history.

The default generator uses `Math.random`. The ids are not secret, they only must not collide. This keeps the package free of `crypto` and of DOM or Node types.

### D6. Suggest

1. Check the input: `find` is not empty, `replace !== find`, no line break (`\n` or `\r`) in either, no CriticMarkup sequence in either (`{++ ++} {-- --} {~~ ~~} ~> {== ==} {>> <<}`), and `author` and `date` are valid values (`date` matches `YYYY-MM-DD`, `author` is not empty and has no `"` or line break). In this order. `markup_in_text` is only for bad input.
2. Parse, and make the agent view (D1). Find all places of `find` in the view, including overlapping ones. If `before` or `after` is given, the view text directly before or after the place must be equal to it. A place that starts or ends between the two halves of a surrogate pair does not count. A place whose note range overlaps a protected zone does not count (remember the reason).
3. Zero places: `protected_zone` if a place was rejected for that reason, else `not_found`. More than one: `ambiguous`. Places that touch a mark count here: the agent sees them, so a choice between them would be a guess. One place: if it overlaps the view range of a mark, or a hidden mark lies strictly inside it, the reason is `overlaps_mark`. A place that only touches the edge of a mark is fine. Map the place back to the note: it is then one plain-text range.
4. Trim: `p` is the length of the common start, `s` the length of the common end, with `s <= min(|find|, |replace|) - p`. Neither may split a surrogate pair (make them shorter if needed). The changed parts are `find[p, |find|-s]` and `replace[p, |replace|-s]`. Extend the start back to the start of the word only if the character before it is not whitespace and the first changed character (of `find` or of `replace`) is not whitespace. Extend the end forward to the end of the word only if the character after it is not whitespace and the last changed character (of `find` or of `replace`; an empty part does not count) is not whitespace. A word is a run of characters that are not whitespace. Keep the changed part inside the place.
5. Block prefix: if the changed part starts before the end of the block prefix of its line, the reason is `structural_edit`. The block prefix is: indentation, `>` quote markers, then a heading marker (`#`…`######` and a space), a list marker (`-`, `*`, `+` or `1.` / `1)` and a space), and a task box (`[ ]`, `[x]`) after a list marker.
6. Write a deletion for the removed part (if not empty) and then an insertion for the added part (if not empty). Each gets a new id (D5), in this order.
7. Outcome check. Parse the marked text and each decision outcome of the new marks: accept all, reject all, and for a replace also the two mixed outcomes. Check:
   - In the marked text, the new marks are found at their places with their kinds and ids.
   - In every text, the other marks are the same (kind, id, content and shifted position): no mark is lost, joined or added.
   - In every text, the zones are the same, shifted, except the change itself.
   - In every outcome, the block structure of the line is the same as in the original note: the same block prefix, and the line is a setext underline (`===` or `---` under a text line) or a thematic break (`---`, `***`, `___`) only if it was one before. For the prefix, spaces and tabs at the start of the line count only when they make 4 or more columns (indented code), and runs of whitespace inside the prefix count as one space. Markdown ignores up to 3 spaces of indentation, and a mixed outcome often leaves one space at the start of the line (`The cat sat.` to `A cat sat.` gives ` cat sat.`).

   A changed block structure gives `structural_edit` (for example `item` to `- item`, a mixed outcome of `Hello # world` to `Hi # world`, or a line under a paragraph that becomes `===`). Any other difference gives `unsafe_result` (for example an unclosed `{++` earlier in the paragraph, a backtick that closes an earlier one, or a replace text that opens a code block or a table).

The error codes are: `empty_find`, `no_change`, `line_break`, `markup_in_text`, `invalid_attribute`, `not_found`, `ambiguous`, `overlaps_mark`, `protected_zone`, `structural_edit`, `unsafe_result`. Each error also has a short English `message`. The hub can give it to the agent as it is.

Alternative: a word diff (LCS) that can make more than one mark pair. Rejected for slice 1: one changed part per suggestion is easier to review and to log. The agent can make more suggestions.

Alternative: search the raw note and use the agent view only to choose an error code. Rejected: in `The {++big ++}cat sat. The big cat ran.` the agent sees "big cat" two times, but the raw search finds one place and edits it without a question.

Alternative: check only the marked text after writing. Rejected: then accepting a replace text of three backticks turns the rest of the note into code, and the reviewer and `decide` lose the pending marks there.

### D7. Decide

Find the mark by `id`. No mark: `not_found`. More than one: `duplicate_id`. Kind is not insertion or deletion: `unsupported_kind`. Then replace the full mark range (`start` to `end`) with the content (accept insertion, reject deletion) or with nothing (reject insertion, accept deletion). The result has the mark as it was, the decision, and `changes` with one change `{ from: start, to: end, insert }`, so that change 2 can dispatch it to CodeMirror.

### D8. Result type

```ts
type Result<T> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };
```

No exceptions for expected refusals. Exceptions only for programming errors (for example a `newId` that never returns a free id).

The error codes of `suggest` are listed in D6. `decide` adds `not_found`, `duplicate_id` and `unsupported_kind`. All are in one `ErrorCode` union for now (see Risks).

### D9. Tests

- One test file per module in `packages/format/test/`, and one file per spec (`markup-format.spec.test.ts`, `change-decisions.spec.test.ts`) with one test per scenario. The scenario names are the test names.
- Property tests with `fast-check` (a dev dependency, version from `npm view` at apply time, in the catalog):
  - round trip: `serialize(parse(t)) === t` for random text built from markup fragments, backticks, fences, `|`, CRLF and emoji
  - a successful suggest, then reject of all its marks, gives the original text
  - a successful suggest, then accept of all its marks, gives the text with `find` replaced by `replace`
  - `assignIds` gives unique ids and does not change text outside mark prefixes
  - after a successful suggest, every decision outcome of its marks leaves the other marks and the zones as they were
- Generators for the suggest properties include pending marks, zones, CRLF, emoji, indentation and `before`/`after`. The properties also check the reported marks (position, id, author, date) and `changes`.
- Rule lists are tested as tables, one row per entry: the 11 markup sequences in `find` and in `replace`, each block-prefix marker, each attribute check, each zone rule edge, and the `newId` alphabet.
- Every error code has a test, and every error has a non-empty `message`.
- No wall-clock limits in tests. They fail on slow machines.

## Risks / Trade-offs

- [The zone rules are not full CommonMark: fences in lists or quotes, indented code next to lists, tables without a leading `|`] → They are simple rules with tests. If a zone is missed, a suggestion can land in code. The hub (change 3) shows the marks, and the user can reject them. We improve the rules when we find real cases.
- [Obsidian syntax is not protected: `%%…%%`, `$$…$$`, HTML blocks, wikilinks with spaces] → A suggestion can split `[[My Note]]` or land in math. We add zones when the agent tools show the need. This adds only requirements to `markup-format`.
- [No line breaks in suggestions] → The agent must split a change over more lines into one suggestion per line. This is safe until spike S1 decides how marks cross block boundaries.
- [The trim rule expands to whole words, so a change of one letter marks the full word] → It is easier to read. That is the intent.
- [Random ids can collide with ids that were in the note in the past] → The chance is about 1 in 2·10^9 per id. Change 3 can pass a `newId` that also checks the log.
- [Reject the deletion and accept the insertion gives `catdog`] → This is the expected Word behavior. The specs say it, so that change 2 does not "fix" it.
- [The parser runs on the full note at each call, and suggest parses up to 6 times (D6 step 7)] → Fine for normal notes (a parse of a note with 3000 marks takes about 3 ms). Change 2 measures it on a large note before it adds caching. "Accept all" as one `decide` per mark is O(marks × length); add a `decideMany` before the review panel needs it (roadmap follow-up).
- [The outcome check refuses replacing the whole text of a setext heading (`Hello` above `===`), because one mixed outcome leaves an empty line, and then `===` is no longer an underline] → Safe side. Setext headings are rare in Obsidian, and adding words to the heading still works.
- [Words are runs of non-whitespace] → CJK text has no spaces, so a change of one character marks the whole run. Roadmap follow-up.
- [More zone gaps: backslash-escaped backticks, `[[wikilinks]]` (a suggestion can split them), callout markers `> [!note]`] → The outcome check (D6 step 7) does not catch these. Roadmap follow-ups.
- [One `ErrorCode` union for all functions, and errors carry no details (match count, zone kind)] → Simple for now. Roadmap follow-up.
- [`Mark` is one mutable shape for all kinds, and `serialize(parsed)` always gives `parsed.text`] → Roadmap follow-up: a readonly, discriminated type, and a decision about `serialize`.

## Migration Plan

None. No notes have MD-Coeditor marks yet. Notes with plain CriticMarkup from other tools are read as marks without ids, and `assignIds` gives them ids.

## Open Questions

- The exact `fast-check` version. Check it with `npm view fast-check version` at apply time (4.10.2 on 2026-10-24).
- Compatibility of the dialect (D4) with existing Obsidian CriticMarkup plugins: how do they store metadata, and do they show our prefix as text? Check this before the first release; it can still move the attributes (for example into an HTML comment). Roadmap open check.
