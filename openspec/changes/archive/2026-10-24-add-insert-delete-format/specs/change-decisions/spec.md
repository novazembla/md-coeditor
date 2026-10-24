# Spec Delta

## Purpose

Change decisions define what happens to a note when the user accepts or rejects a tracked change. Each mark is decided on its own, and the result is reported so that the decision can be logged and shown to the agent.

## ADDED Requirements

### Requirement: Accept and reject an insertion
Accepting an insertion SHALL replace the whole mark, with its attributes, by its content. Rejecting an insertion SHALL remove the whole mark. All other text SHALL stay the same.

#### Scenario: Accept insertion
- **WHEN** the note contains `The {id="a1"++big ++}cat.` and the user accepts `a1`
- **THEN** the note becomes `The big cat.`

#### Scenario: Reject insertion
- **WHEN** the note contains `The {id="a1"++big ++}cat.` and the user rejects `a1`
- **THEN** the note becomes `The cat.`

### Requirement: Accept and reject a deletion
Accepting a deletion SHALL remove the whole mark. Rejecting a deletion SHALL replace the whole mark, with its attributes, by its content. All other text SHALL stay the same.

#### Scenario: Accept deletion
- **WHEN** the note contains `A {id="d1"--very --}big cat.` and the user accepts `d1`
- **THEN** the note becomes `A big cat.`

#### Scenario: Reject deletion
- **WHEN** the note contains `A {id="d1"--very --}big cat.` and the user rejects `d1`
- **THEN** the note becomes `A very big cat.`

### Requirement: Marks of a replace are decided on their own
A replace is a deletion followed by an insertion. Each mark SHALL be decided on its own, and a decision on one mark SHALL NOT change the other mark.

#### Scenario: Accept both
- **WHEN** the note contains `{id="d1"--cat--}{id="a1"++dog++}` and the user accepts `d1` and then `a1`
- **THEN** the text is `dog`

#### Scenario: Reject both
- **WHEN** the user rejects `d1` and then `a1`
- **THEN** the text is `cat`

#### Scenario: Reject the deletion, accept the insertion
- **WHEN** the user rejects `d1` and accepts `a1`
- **THEN** the text is `catdog`

#### Scenario: One decided, one pending
- **WHEN** the user accepts `d1` only
- **THEN** the note contains `{id="a1"++dog++}` unchanged

### Requirement: Decisions address a mark by id
A decision SHALL name the mark by its id. The decision SHALL be refused, and the note SHALL NOT change, when no mark has that id, when more than one mark has that id, or when the mark is a substitution, highlight or comment.

#### Scenario: Unknown id
- **WHEN** the user accepts an id that is not in the note
- **THEN** the decision is refused with the reason "not found"

#### Scenario: Duplicate id
- **WHEN** two marks have the id `a1` and the user accepts `a1`
- **THEN** the decision is refused with the reason "duplicate id"

#### Scenario: Unsupported kind
- **WHEN** the mark `s1` is a substitution and the user accepts `s1`
- **THEN** the decision is refused with the reason "unsupported kind"
- **AND** the note does not change

### Requirement: Decision result
A successful decision SHALL report the new note text, and the decided mark as it was before the decision: id, kind, content, author, date, its position, and whether it was accepted or rejected. It SHALL also report the change to the note text: the start and end of the replaced range in the text before the decision, and the inserted text.

#### Scenario: Result of an accepted insertion
- **WHEN** the user accepts the insertion `a1` with content `big ` by `Claude`
- **THEN** the result has the id `a1`, kind insertion, content `big `, author `Claude`, the decision accept, and the new text
- **AND** the result has one change from the start to the end of the mark, with the inserted text `big `

#### Scenario: Result of a rejected insertion
- **WHEN** the user rejects the insertion `a1`
- **THEN** the result has the decision reject and one change from the start to the end of the mark, with an empty inserted text
