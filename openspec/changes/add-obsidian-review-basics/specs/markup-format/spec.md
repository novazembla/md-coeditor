# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
