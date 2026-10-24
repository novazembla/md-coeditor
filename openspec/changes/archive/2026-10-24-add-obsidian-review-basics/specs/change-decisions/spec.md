# Spec Delta

## ADDED Requirements

### Requirement: Accept and reject the change at the cursor
In Live Preview, the commands "Accept change" and "Reject change" SHALL decide the insertion or deletion at the cursor. A mark is at the cursor when the cursor is inside its visible text or directly before or after it. When two marks touch the cursor, the mark that starts at the cursor SHALL be decided.

#### Scenario: Accept with the cursor inside an insertion
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is between `b` and `i`, and the user runs "Accept change"
- **THEN** the note becomes `The big cat.`

#### Scenario: Reject with the cursor inside a deletion
- **WHEN** the note contains `A {id="d1"--very --}big cat.`, the cursor is between `v` and `e`, and the user runs "Reject change"
- **THEN** the note becomes `A very big cat.`

#### Scenario: Cursor between the two marks of a replace
- **WHEN** the note contains `The {id="d1"--cat--}{id="a1"++dog++} sat.`, the cursor is directly after `cat` (directly before `dog`), and the user runs "Accept change"
- **THEN** the note becomes `The {id="d1"--cat--}dog sat.`

#### Scenario: Decide both marks of a replace one after the other
- **WHEN** the note contains `The {id="d1"--cat--}{id="a1"++dog++} sat.`, the cursor is inside `cat`, and the user runs "Accept change" two times
- **THEN** the note becomes `The dog sat.`

### Requirement: Decisions from the right-click menu
In Live Preview, a right-click on the visible text of an insertion or deletion SHALL show the items "Accept change" and "Reject change" in the editor menu. Each item SHALL decide the mark under the mouse pointer. A right-click elsewhere SHALL NOT show these items.

#### Scenario: Reject from the menu
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the user right-clicks on `big` and chooses "Reject change"
- **THEN** the note becomes `The cat.`

#### Scenario: Right-click on plain text
- **WHEN** the user right-clicks on `cat.` in `The {id="a1"++big ++}cat.`
- **THEN** the menu has no item "Accept change" and no item "Reject change"

### Requirement: A mark without an id gets one when it is decided
When the user decides a mark that has no id, or whose id another mark also has, the mark SHALL get a new unique id in the same step, and the decision SHALL use it. Opening a note SHALL NOT change it, and the decision SHALL NOT change other marks.

#### Scenario: Accept an insertion without an id
- **WHEN** the note contains `The {++big ++}cat.` and the user accepts the insertion
- **THEN** the note becomes `The big cat.`
- **AND** the decision result has an id of 6 characters from `[a-z0-9]`

#### Scenario: Other marks without an id stay as they are
- **WHEN** the note contains `{++a++} and {++b++}` and the user accepts the first insertion
- **THEN** the note becomes `a and {++b++}`

#### Scenario: Duplicate id
- **WHEN** the note contains `{id="a1"++x++} and {id="a1"++y++}` and the user rejects the second insertion
- **THEN** the note becomes `{id="a1"++x++} and `

#### Scenario: Opening a note does not change it
- **WHEN** the user opens a note that contains `The {++big ++}cat.` and does not decide anything
- **THEN** the file on disk still contains `The {++big ++}cat.`

### Requirement: One decision is one undo step
Each decision SHALL be one undo step. Undo SHALL restore the note text as it was before the decision, also when the decision gave the mark a new id.

#### Scenario: Undo an accept
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the user accepts `a1` and then runs Undo one time
- **THEN** the note is `The {id="a1"++big ++}cat.`

#### Scenario: Undo an accept of a mark without an id
- **WHEN** the note contains `The {++big ++}cat.`, the user accepts the insertion and then runs Undo one time
- **THEN** the note is `The {++big ++}cat.`

### Requirement: Decisions that cannot be made show a notice
When "Accept change" or "Reject change" cannot decide a mark, the note SHALL NOT change and a notice SHALL tell the reason: `No change at the cursor.` when no insertion or deletion is at the cursor, and `Not supported yet: <kind>.` when the mark at the cursor is a substitution, highlight or comment.

#### Scenario: No mark at the cursor
- **WHEN** the note contains `The {id="a1"++big ++}cat.`, the cursor is between `c` and `a` of `cat`, and the user runs "Accept change"
- **THEN** the note does not change and a notice shows `No change at the cursor.`

#### Scenario: Substitution at the cursor
- **WHEN** the note contains `A {~~cat~>dog~~} sat.`, the cursor is inside `cat`, and the user runs "Reject change"
- **THEN** the note does not change and a notice shows `Not supported yet: substitution.`

### Requirement: Decisions only in Live Preview
The commands "Accept change" and "Reject change" SHALL be available only when the active note is in Live Preview. In Source mode and in Reading view, they SHALL NOT be offered.

#### Scenario: Source mode
- **WHEN** the active note is in Source mode and the user opens the command palette
- **THEN** the palette does not list "Accept change" or "Reject change"
