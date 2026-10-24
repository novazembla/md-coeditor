# markup-format Specification

## Purpose

The markup format defines how MD-Coeditor stores tracked changes inside a Markdown note: the CriticMarkup marks with their attributes, the zones where marks are not allowed, and how a suggestion becomes marks. The note stays the source of truth and is readable without the plugin.

## Requirements

### Requirement: Recognize the five mark kinds
The format SHALL recognize these marks: insertion `{++text++}`, deletion `{--text--}`, substitution `{~~old~>new~~}`, highlight `{==text==}` and comment `{>>text<<}`. A mark ends at the first closing sequence of its kind. A mark SHALL NOT contain a blank line. An opening sequence without a valid end is plain text.

#### Scenario: Insertion and deletion
- **WHEN** a note contains `The {--old--}{++new++} text.`
- **THEN** the parse result has the plain text `The `, a deletion with content `old`, an insertion with content `new`, and the plain text ` text.`

#### Scenario: Substitution
- **WHEN** a note contains `{~~cat~>dog~~}`
- **THEN** the parse result has one substitution with old content `cat` and new content `dog`

#### Scenario: Unclosed mark
- **WHEN** a note contains `Use {++ with care.` and no `++}` follows
- **THEN** the parse result has only plain text

#### Scenario: Blank line ends the search
- **WHEN** a note contains `{++first paragraph`, a blank line, and then `second++}`
- **THEN** the parse result has no mark

#### Scenario: Single line break in a mark
- **WHEN** a note contains `{++line one` and on the next line `line two++}`
- **THEN** the parse result has one insertion whose content contains the line break

### Requirement: Mark attributes
A mark MAY have an attribute prefix between `{` and the operator: one or more `name="value"` pairs separated by spaces or tabs. The known attributes are `id`, `author` and `date` (`YYYY-MM-DD`). The format SHALL keep unknown attributes and their order. A value SHALL NOT contain `"`, `{`, `}` or a line break. If the prefix is not valid, the `{` is plain text. This is the attribute format of the obsidian-track-changes plugin.

#### Scenario: Attributes are read
- **WHEN** a note contains `{id="k3f9qz" author="Claude" date="2026-10-24"++new++}`
- **THEN** the insertion has id `k3f9qz`, author `Claude` and date `2026-10-24`

#### Scenario: Mark without attributes
- **WHEN** a note contains `{++new++}`
- **THEN** the insertion has no id, no author and no date

#### Scenario: Unknown attribute is kept
- **WHEN** a note contains `{id="a1" edited-by="Vincent"++x++}`
- **THEN** the insertion has the attribute `edited-by` with value `Vincent`
- **AND** the serialized text is the same as the input

#### Scenario: Invalid prefix
- **WHEN** a note contains `{id="a1 ++x++}` (the quote is not closed)
- **THEN** the parse result has no mark

#### Scenario: Tab between attributes
- **WHEN** a note contains `{id="a1"` followed by a tab, then `author="Claude"++x++}`
- **THEN** the insertion has id `a1` and author `Claude`
- **AND** the serialized text is the same as the input

#### Scenario: Brace in a value
- **WHEN** a note contains `{id="a{1}"++x++}`
- **THEN** the parse result has no mark

### Requirement: Lossless round trip
Serializing the parse result of any text SHALL give back the same text, byte for byte. This includes text with malformed marks, CRLF line endings, and non-ASCII characters.

#### Scenario: Round trip
- **WHEN** any text is parsed and then serialized
- **THEN** the result is equal to the input

#### Scenario: CRLF line endings
- **WHEN** a note with CRLF line endings is parsed and then serialized
- **THEN** the line endings are still CRLF

### Requirement: Positions in UTF-16 code units
Each mark and each protected zone in the parse result SHALL have a start and an end position in the note. Positions SHALL count UTF-16 code units from the start of the text, the same unit as a JavaScript string index and a CodeMirror position.

#### Scenario: Position after non-ASCII text
- **WHEN** a note contains `😀 {++x++}`
- **THEN** the insertion starts at position 3

### Requirement: Protected zones
The format SHALL find these protected zones: YAML frontmatter at the start of the note, fenced code blocks, indented code blocks, inline code spans, and tables. Marks SHALL NOT be recognized inside a protected zone, and a mark SHALL NOT cross the start or end of a block zone. An unclosed fenced code block continues to the end of the note.

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

### Requirement: Unique mark ids
Each mark that MD-Coeditor creates SHALL get an id that is not used by another mark in the note. The format SHALL report ids that occur more than once. On request, it SHALL give a new id to each mark without an id, and to each occurrence of a duplicate id after the first. It SHALL NOT change other text, and it SHALL report each change to the text (position in the old text and the new text).

#### Scenario: Duplicate id is reported
- **WHEN** a note has two marks with the id `a1`
- **THEN** the parse result reports `a1` as a duplicate

#### Scenario: Ids are assigned
- **WHEN** ids are assigned in a note with `{++x++}` and two marks with the id `a1`
- **THEN** the mark `{++x++}` gets a new id
- **AND** the first mark with `a1` keeps it, and the second mark gets a new id
- **AND** all ids in the note are different

### Requirement: Agent view
The format SHALL give the agent view of a note: the text as if all pending marks were accepted. Plain text stays as it is. Insertions and highlights show their content, and substitutions show their new text. Deletions and comments are hidden. The format SHALL map each position in the agent view back to a position in the note.

#### Scenario: View of a replace
- **WHEN** a note contains `The {--old--}{++new++} text.`
- **THEN** the agent view is `The new text.`

#### Scenario: Comments are hidden
- **WHEN** a note contains `A {==big==}{>>why?<<} cat.`
- **THEN** the agent view is `A big cat.`

### Requirement: Suggestion makes insertion and deletion marks
A suggestion has a find text, a replace text, an author and a date. The format SHALL mark only the changed part: it removes the common start and end of the two texts, and then extends the changed part to whole words. Removed text SHALL become a deletion, added text an insertion, deletion first. Each new mark SHALL have its own new id, the author and the date.

#### Scenario: Replace a word
- **WHEN** the note contains `The cat sat.` and the suggestion replaces `cat sat` with `dog sat` by `Claude` on `2026-10-24`
- **THEN** the note becomes `The {id="<id1>" author="Claude" date="2026-10-24"--cat--}{id="<id2>" author="Claude" date="2026-10-24"++dog++} sat.`
- **AND** `<id1>` and `<id2>` are different

#### Scenario: Only an insertion
- **WHEN** the note contains `The cat sat.` and the suggestion replaces `cat sat` with `black cat sat`
- **THEN** the note gets one insertion with content `black ` before `cat`, and no deletion

#### Scenario: Only a deletion
- **WHEN** the note contains `A very big cat.` and the suggestion replaces `very big` with `big`
- **THEN** the note gets one deletion with content `very ` and no insertion

#### Scenario: Whole words
- **WHEN** the note contains `The cat sat.` and the suggestion replaces `cat` with `cut`
- **THEN** the deletion content is `cat` and the insertion content is `cut`

#### Scenario: Change an emoji
- **WHEN** the note contains `I like 😀 a lot.` and the suggestion replaces `😀` with `😁`
- **THEN** the deletion content is `😀` and the insertion content is `😁`

#### Scenario: Result reports the new marks
- **WHEN** a suggestion succeeds
- **THEN** the result has the new note text and, for each new mark, its id, kind, content and position
- **AND** the result has the change to the note text: its start and end in the old text, and the inserted text

### Requirement: Suggestion target must be unique
The find text SHALL match exactly one place in the agent view. Optional text before and after the find text SHALL narrow the match: it must occur directly before or after the match in the agent view. Matches that overlap a protected zone SHALL NOT count. Matches that touch or overlap a pending mark SHALL count, so that the format never chooses between places that the agent sees. A match SHALL NOT start or end inside a character that takes two UTF-16 code units (for example an emoji).

#### Scenario: Not found
- **WHEN** the find text does not occur in the note
- **THEN** the suggestion is refused with the reason "not found"
- **AND** the note does not change

#### Scenario: Two matches
- **WHEN** the find text occurs two times in plain text
- **THEN** the suggestion is refused with the reason "ambiguous"

#### Scenario: Context makes it unique
- **WHEN** the find text occurs two times, and the text before is given and matches only before the second occurrence
- **THEN** the suggestion changes the second occurrence

#### Scenario: Match next to a mark counts
- **WHEN** the note contains `The {++big ++}cat sat. The big cat ran.` and the find text is `big cat`
- **THEN** the suggestion is refused with the reason "ambiguous"

#### Scenario: Matches in a zone do not count
- **WHEN** the note contains `` `cat` and cat `` and the find text is `cat`
- **THEN** the suggestion changes the second `cat`

#### Scenario: Context across a mark
- **WHEN** the note contains `The {++big ++}cat sat.`, the find text is `cat` and the text before is `The big `
- **THEN** the suggestion succeeds
- **AND** the mark `{++big ++}` is unchanged

#### Scenario: Emoji is not split
- **WHEN** the note contains `a 😀 cat` and the find text is the second half of the emoji followed by ` cat`
- **THEN** the suggestion is refused with the reason "not found"

### Requirement: Unsafe suggestions are refused
The format SHALL refuse a suggestion, and SHALL NOT change the note, when: the find text is empty; replace equals find; a match overlaps a pending mark; a match overlaps a protected zone; find or replace has a line break; find or replace contains a CriticMarkup opening or closing sequence; the marked part would include a line's block prefix (heading, list, task or quote marker, or indentation); or the author or date is not a valid attribute value.

#### Scenario: Overlaps a pending mark
- **WHEN** the note contains `The {++big ++}cat.` and the find text is `big cat`
- **THEN** the suggestion is refused with the reason "overlaps mark"

#### Scenario: Next to a pending mark
- **WHEN** the note contains `The {++big ++}cat.` and the find text is `cat`
- **THEN** the suggestion succeeds

#### Scenario: Inside a protected zone
- **WHEN** the find text occurs only inside a fenced code block
- **THEN** the suggestion is refused with the reason "protected zone"

#### Scenario: Line break
- **WHEN** the find text or the replace text contains a line break
- **THEN** the suggestion is refused with the reason "line break"

#### Scenario: Markup in the replace text
- **WHEN** the replace text contains `{++`
- **THEN** the suggestion is refused with the reason "markup in text"

#### Scenario: Markup in the find text
- **WHEN** the note has the plain text `a --} b` and the find text is `--}`
- **THEN** the suggestion is refused with the reason "markup in text"

#### Scenario: Block prefix
- **WHEN** the note has the line `# Intro` and the suggestion replaces `# Intro` with `## Intro`
- **THEN** the suggestion is refused with the reason "structural edit"

#### Scenario: Heading text can change
- **WHEN** the note has the line `# Intro` and the suggestion replaces `Intro` with `Overview`
- **THEN** the suggestion succeeds and the line starts with `# `

#### Scenario: No change
- **WHEN** the replace text equals the find text
- **THEN** the suggestion is refused with the reason "no change"

### Requirement: Decision outcomes stay safe
The format SHALL check the marked note and each decision outcome of the new marks (all accepted, all rejected, and both mixed outcomes of a replace). It SHALL refuse the suggestion with "structural edit" when an outcome changes a line's block structure (block prefix, setext underline or thematic break), and with "unsafe result" when the new marks combine with existing markup or code, or an outcome changes other marks or protected zones.

#### Scenario: New list marker
- **WHEN** the note has the line `item` and the suggestion replaces `item` with `- item`
- **THEN** the suggestion is refused with the reason "structural edit"

#### Scenario: Mixed decision exposes a heading
- **WHEN** the note has the line `Hello # world` and the suggestion replaces `Hello # world` with `Hi # world`
- **THEN** the suggestion is refused with the reason "structural edit", because accepting the deletion and rejecting the insertion gives the heading ` # world`

#### Scenario: Line becomes a setext underline
- **WHEN** the note has the line `Hello` and the next line `World`, and the suggestion replaces `World` with `===`
- **THEN** the suggestion is refused with the reason "structural edit"

#### Scenario: Leading space after a mixed decision is fine
- **WHEN** the note has the line `The cat sat.` and the suggestion replaces `The cat` with `A cat`
- **THEN** the suggestion succeeds

#### Scenario: Unclosed mark before the place
- **WHEN** the note contains `Use {++ with care.` and the suggestion replaces `care` with `caution`
- **THEN** the suggestion is refused with the reason "unsafe result"
- **AND** the note does not change

#### Scenario: Replace text opens a code block
- **WHEN** the note contains a line `Hello` and later lines with a pending mark, and the suggestion replaces `Hello` with three backticks
- **THEN** the suggestion is refused with the reason "unsafe result"

#### Scenario: Backtick joins inline code
- **WHEN** the note contains ``Say ` hi`` and the suggestion replaces `hi` with `` hi` ``
- **THEN** the suggestion is refused with the reason "unsafe result"

### Requirement: Suggestion date is a calendar date
The date of a suggestion SHALL be a real calendar date in the form `YYYY-MM-DD`. Otherwise the suggestion SHALL be refused with the reason "invalid attribute", and the note SHALL NOT change. Parsing a note SHALL still read any date value as it is.

#### Scenario: Day that does not exist
- **WHEN** a suggestion has the date `2026-02-30`
- **THEN** the suggestion is refused with the reason "invalid attribute"

#### Scenario: Leap day
- **WHEN** a suggestion has the date `2028-02-29`
- **THEN** the suggestion succeeds and the new marks have the date `2028-02-29`

#### Scenario: Day in a year that is not a leap year
- **WHEN** a suggestion has the date `2026-02-29`
- **THEN** the suggestion is refused with the reason "invalid attribute"

#### Scenario: Parse keeps any date value
- **WHEN** a note contains `{id="a1" date="2026-02-30"++x++}`
- **THEN** the insertion has the date `2026-02-30`
