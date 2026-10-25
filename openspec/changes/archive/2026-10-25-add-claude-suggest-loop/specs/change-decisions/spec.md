# Spec Delta

## ADDED Requirements

### Requirement: Decisions in Obsidian are logged
Each successful accept and reject in Obsidian (command, hotkey or right-click menu) SHALL append one `decision` event to the vault's event log, after the note changed. A decision that cannot be made (notice, no change) SHALL NOT be logged.

#### Scenario: Accept from the menu
- **WHEN** the user right-clicks the insertion `{id="i1bbbb" author="Claude"++slow++}` in `essay.md` and chooses "Accept change"
- **THEN** the note contains `slow` without the mark
- **AND** the last log event is a `decision` with `id` `i1bbbb` and `decision` `accepted`

#### Scenario: No change at the cursor
- **WHEN** the user runs "Reject change" with the cursor on plain text
- **THEN** the notice `No change at the cursor.` shows
- **AND** the log does not change
