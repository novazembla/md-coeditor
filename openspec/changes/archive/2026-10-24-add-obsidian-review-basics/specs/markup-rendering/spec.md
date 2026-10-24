# Spec Delta

## Purpose

Markup rendering defines how the tracked changes in a note look in Obsidian, so that the user reads the suggestions inline, where they read the note, and not as raw CriticMarkup. It also covers how the user moves from one change to the next.

## ADDED Requirements

### Requirement: Insertions look like inserted text in Live Preview
In Live Preview, the content of an insertion SHALL show green and underlined. The rest of the line SHALL look as before.

#### Scenario: Insertion with attributes
- **WHEN** the note contains `The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.` and the editor is in Live Preview
- **THEN** the line shows the text `The big cat.`
- **AND** `big ` is green and underlined, and `The ` and `cat.` have no change style

#### Scenario: Insertion without attributes
- **WHEN** the note contains `The {++big ++}cat.` and the editor is in Live Preview
- **THEN** the line shows the text `The big cat.` with `big ` green and underlined

### Requirement: Deletions look like deleted text in Live Preview
In Live Preview, the content of a deletion SHALL show red and struck through. The deleted text SHALL stay visible until the user decides.

#### Scenario: Deletion
- **WHEN** the note contains `A {id="d1"--very --}big cat.` and the editor is in Live Preview
- **THEN** the line shows the text `A very big cat.`
- **AND** `very ` is red and struck through

#### Scenario: Replace
- **WHEN** the note contains `The {id="d1"--cat--}{id="a1"++dog++} sat.` and the editor is in Live Preview
- **THEN** the line shows the text `The catdog sat.` with `cat` red and struck through and `dog` green and underlined

### Requirement: Mark syntax is always hidden in Live Preview
In Live Preview, the braces, the operators and the attribute prefix of an insertion or deletion SHALL NOT show, also when the cursor or the selection is inside or next to the mark.

#### Scenario: Cursor inside the mark
- **WHEN** the note contains `The {id="a1" author="Claude"++big ++}cat.` and the cursor is between `b` and `i`
- **THEN** the line still shows the text `The big cat.`

#### Scenario: Mark over two lines
- **WHEN** the note contains `{id="a1"++one` on one line and `two++} end` on the next line
- **THEN** the first line shows `one` and the second line shows `two end`, with `one` and `two` green and underlined

### Requirement: The cursor never stops inside hidden syntax
In Live Preview, the cursor SHALL NOT be placed inside a hidden part of a mark. Each press of the left or right arrow key (also with Shift) SHALL move the cursor over exactly one visible character, also where hidden parts are next to the cursor. A click SHALL place the cursor before or after the hidden part.

#### Scenario: Arrow key over the hidden prefix
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is directly after `The `, and the user presses the right arrow key one time
- **THEN** the cursor is directly after `b`

#### Scenario: Arrow key out of a mark
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is directly after `big `, and the user presses the right arrow key one time
- **THEN** the cursor is directly after `c`

#### Scenario: One key press for each visible character
- **WHEN** the note contains `The {id="d1"--cat--}{id="a1"++dog++} sat.` and the user moves the cursor from the start to the end of the line with the right arrow key, and back with the left arrow key
- **THEN** each key press moves the cursor over one visible character of `The catdog sat.`

#### Scenario: No cursor position in the prefix
- **WHEN** the note contains `The {id="a1"++big ++}cat.` and the user moves the cursor through the whole line with the arrow keys
- **THEN** the cursor is never between `{` and the first `b`, and never between the last space of `big ` and `}`

### Requirement: Edits keep the mark syntax whole
In Live Preview, a user edit (typing, Backspace, Delete, cut, paste or drag) that covers only part of the syntax of a mark SHALL NOT change that syntax. The edit SHALL still change the visible text it covers. An edit that covers the whole mark SHALL remove the whole mark.

#### Scenario: Backspace at the start of an insertion
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is directly before `big`, and the user presses Backspace
- **THEN** the note becomes `The{id="a1"++big ++}cat.`

#### Scenario: Delete a selection that covers part of a mark
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the user selects the visible text `e bi` and presses Backspace
- **THEN** the note becomes `Th{id="a1"++g ++}cat.`

#### Scenario: Delete a selection that covers the whole mark
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the user selects the visible text `The big cat.` and presses Backspace
- **THEN** the note becomes empty

#### Scenario: Typing inside an insertion
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is directly after `big`, and the user types `gest`
- **THEN** the note becomes `The {id="a1"++biggest ++}cat.`

#### Scenario: Changes from outside the editor are not filtered
- **WHEN** the note `The {id="a1"++big ++}cat.` changes on disk to `The {id="a1"++small ++}cat.` and Obsidian reloads it
- **THEN** the editor contains `The {id="a1"++small ++}cat.`

### Requirement: Author and date on hover
When the mouse pointer rests on the visible text of an insertion or deletion, in Live Preview or in Reading view, a tooltip SHALL show the author and the date of the mark. A missing value SHALL show as `Unknown author` or SHALL be left out (date).

#### Scenario: Author and date
- **WHEN** the pointer rests on `big ` in `The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.`
- **THEN** the tooltip shows `Claude, 2026-10-24`

#### Scenario: No attributes
- **WHEN** the pointer rests on `big ` in `The {++big ++}cat.`
- **THEN** the tooltip shows `Unknown author`

### Requirement: Reading view shows the changes
In Reading view, insertions and deletions SHALL show with the same styles as in Live Preview, and their syntax SHALL NOT show. Markdown formatting inside a mark SHALL still render.

#### Scenario: Insertion and deletion in Reading view
- **WHEN** the note contains `The {id="d1"--cat--}{id="a1"++dog++} sat.` and the note is in Reading view
- **THEN** the paragraph shows the text `The catdog sat.` with `cat` red and struck through and `dog` green and underlined

#### Scenario: Formatting inside a mark
- **WHEN** the note contains `A {id="a1"++**bold** idea++}.` and the note is in Reading view
- **THEN** the paragraph shows the text `A bold idea.` with `bold` in bold, and `bold idea` green and underlined

### Requirement: Reading view has no decisions
Reading view SHALL only show the current state of the note. It SHALL NOT offer accept or reject.

#### Scenario: Right-click in Reading view
- **WHEN** the note is in Reading view and the user right-clicks on an insertion
- **THEN** the menu has no item "Accept change" and no item "Reject change"

### Requirement: Source mode shows the raw text
In Source mode, the note SHALL show its text as it is in the file, with no change styles and no hidden parts.

#### Scenario: Raw mark in Source mode
- **WHEN** the note contains `The {id="a1" author="Claude"++big ++}cat.` and the editor is in Source mode
- **THEN** the line shows `The {id="a1" author="Claude"++big ++}cat.` with no change style

### Requirement: No rendering in protected zones
Text that looks like a mark inside a protected zone (frontmatter, code block, inline code or table) SHALL show as it is, in Live Preview and in Reading view.

#### Scenario: Mark syntax in inline code
- **WHEN** the note contains ``Use `{++x++}` here.``
- **THEN** Live Preview and Reading view show `{++x++}` as inline code, with no change style

### Requirement: Other mark kinds keep their current look
Substitutions, highlights and comments SHALL show as Obsidian shows them without this plugin, in Live Preview and in Reading view.

#### Scenario: Substitution
- **WHEN** the note contains `A {~~cat~>dog~~} sat.` and the editor is in Live Preview
- **THEN** the plugin adds no change style and hides no syntax in this line

### Requirement: Go to the next or previous change
The commands "Go to next change" and "Go to previous change" SHALL move the cursor in Live Preview to the start of the visible text of the next or previous insertion or deletion, and show it. After the last change, "next" SHALL continue at the first change; before the first change, "previous" SHALL continue at the last change. Other mark kinds SHALL be skipped.

#### Scenario: Next change
- **WHEN** the note is `A {id="a1"++big++} cat {id="d1"--sat--} {~~x~>y~~} {id="a2"++here++}.` and the cursor is at the start of the note
- **THEN** "Go to next change" puts the cursor directly before `big`, a second time directly before `sat`, and a third time directly before `here`

#### Scenario: Next change wraps around
- **WHEN** the cursor is directly before `here` in the note above and the user runs "Go to next change"
- **THEN** the cursor is directly before `big`

#### Scenario: Previous change
- **WHEN** the cursor is directly before `sat` in the note above and the user runs "Go to previous change"
- **THEN** the cursor is directly before `big`

#### Scenario: No changes
- **WHEN** the note has no insertion and no deletion and the user runs "Go to next change"
- **THEN** the cursor does not move and a notice shows `No changes in this note.`
