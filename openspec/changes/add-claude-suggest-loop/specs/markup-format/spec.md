# Spec Delta

## MODIFIED Requirements

### Requirement: Protected zones
The format SHALL find these protected zones: YAML frontmatter at the start of the note, fenced code blocks, indented code blocks, inline code spans, tables, wikilinks and embeds (`[[...]]`, `![[...]]`), and callout markers (`[!type]` with an optional `+` or `-` at the start of a quote line). Marks SHALL NOT be recognized inside a protected zone, and a mark SHALL NOT cross the start or end of a block zone. An unclosed fenced code block continues to the end of the note. As in CommonMark, a backtick after an odd number of backslashes SHALL NOT open an inline code span, and inside an inline code span a backslash SHALL be a normal character, so it does not stop the span from closing.

#### Scenario: Mark syntax in a fenced code block
- **WHEN** a note contains a fenced code block with the line `{++x++}`
- **THEN** the parse result has no mark
- **AND** the code block is a protected zone

#### Scenario: Frontmatter
- **WHEN** a note starts with `---`, a line `title: {++x++}`, and `---`
- **THEN** the frontmatter is a protected zone
- **AND** the parse result has no mark

#### Scenario: Frontmatter after a byte order mark
- **WHEN** a note starts with the byte order mark `U+FEFF`, then `---`, a line `title: {++x++}`, and `---`
- **THEN** the frontmatter is a protected zone
- **AND** the parse result has no mark

#### Scenario: Table
- **WHEN** a note contains a header row `| a | b |`, a delimiter row `|---|---|` and a body row
- **THEN** the three rows are one protected zone

#### Scenario: Inline code before a mark
- **WHEN** a line contains `` `{++x++}` ``
- **THEN** the inline code is a protected zone and there is no mark

#### Scenario: Inline code inside a mark
- **WHEN** a line contains `` {++run `make`++} ``
- **THEN** the parse result has one insertion with the content `` run `make` ``

#### Scenario: Wikilink
- **WHEN** a line contains `See [[Project plan|the plan]] today.`
- **THEN** `[[Project plan|the plan]]` is a protected zone of the kind `wikilink`

#### Scenario: Embed
- **WHEN** a line contains `![[diagram.png]]`
- **THEN** `![[diagram.png]]` is a protected zone of the kind `wikilink`

#### Scenario: Callout marker
- **WHEN** a note has the line `> [!note]- Read this`
- **THEN** `[!note]-` is a protected zone of the kind `callout-marker`
- **AND** `Read this` is not in a protected zone

#### Scenario: Escaped backticks
- **WHEN** a line contains `` a \` b {++x++} \` c ``
- **THEN** the parse result has one insertion with the content `x`

#### Scenario: Backslash at the end of inline code
- **WHEN** a line contains `` Run `cd C:\` then {++x++} ``
- **THEN** `` `cd C:\` `` is a protected zone of the kind `inline-code`
- **AND** the parse result has one insertion with the content `x`

## ADDED Requirements

### Requirement: Refusals carry details
A refusal with the reason "ambiguous" SHALL report the number of matches. A refusal with the reason "protected zone" SHALL report the kind of the zone that the match overlaps. A refusal with the reason "overlaps mark" SHALL report the ids of the pending marks that the match overlaps. The message SHALL name the same value.

#### Scenario: Three matches
- **WHEN** the note contains `cat, cat, cat` and the find text is `cat`
- **THEN** the suggestion is refused with the reason "ambiguous" and the match count 3
- **AND** the message contains `3`

#### Scenario: Match in a wikilink
- **WHEN** the note contains `See [[Project plan]].` and the find text is `Project plan`
- **THEN** the suggestion is refused with the reason "protected zone" and the zone kind `wikilink`

#### Scenario: Match overlaps a pending mark
- **WHEN** the note contains `The {id="i1bbbb"++big ++}cat.` and the find text is `big cat`
- **THEN** the suggestion is refused with the reason "overlaps mark" and the ids `["i1bbbb"]`
- **AND** the message contains `i1bbbb`
