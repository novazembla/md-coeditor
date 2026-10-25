# event-log Specification

## Purpose

The event log is the local history of a vault on one machine: which suggestions the agent made and which decisions the user took. The digest and `get_detail` read it. It is not the source of truth: the note is.

## Requirements

### Requirement: One log file for each machine
The log SHALL be the file `.coedit/local/<machine>/log/events.jsonl` in the vault, with one JSON object per line, in the order of writing. `<machine>` SHALL be the machine name: the host name up to the first `.`, in lower case, with each character outside `a-z`, `0-9` and `-` changed to `-`. The Obsidian plugin SHALL be its only writer. Other programs SHALL only read it. A program SHALL NOT read or write the folder of another machine.

#### Scenario: First event creates the file
- **WHEN** a vault has no `.coedit/` folder, the host name is `Work-Mac.local`, and the user accepts a change
- **THEN** `.coedit/local/work-mac/log/events.jsonl` exists and has one line with a `decision` event

#### Scenario: Two machines sync one vault
- **WHEN** the vault is synced between the machines `work-mac` and `home-pc`, and the user accepts a change on each machine
- **THEN** each machine's log has only its own decision

### Requirement: The log has an id
When the plugin creates `events.jsonl`, it SHALL also write `log/log-id` with a new random id. A log that is created again SHALL get a new id.

#### Scenario: Log created again
- **WHEN** the log folder is deleted and the user then accepts a change
- **THEN** `log/log-id` exists and holds a different id than before

### Requirement: Events have a rising sequence number
Each event SHALL have a `seq` that is 1 higher than the `seq` of the event before it in the file. The first event SHALL have `seq` 1. After a restart of Obsidian, the next event SHALL continue from the last valid `seq` in the file. A broken last line SHALL NOT damage the next event.

#### Scenario: Sequence after a restart
- **WHEN** the log ends with an event with `seq` 41, Obsidian restarts, and the user rejects a change
- **THEN** the new event has `seq` 42

#### Scenario: Torn last line
- **WHEN** the log ends with the valid event `seq` 41 and then half a line without a line end, and the user accepts a change
- **THEN** the new event is on its own line, is valid JSON, and has `seq` 42

### Requirement: Event envelope
Each event SHALL have the fields `v` (the event format version, `1`), `seq`, `ts` (ISO 8601 time with time zone), `type`, `path` (vault-relative path of the note, with the real case of the file) and `actor` (`user` or `agent`). An agent event SHALL also have `agent` (for example `claude`) and `session` (the session id of the requirement "A session is one launcher run").

#### Scenario: Agent event
- **WHEN** the agent in session `run-1` makes a suggestion in `essay.md`
- **THEN** the event has `v` 1, `type` `suggestion`, `path` `essay.md`, `actor` `agent`, `agent` `claude` and `session` `run-1`

#### Scenario: User event
- **WHEN** the user accepts a change in `essay.md`
- **THEN** the event has `actor` `user` and no `session` field

### Requirement: Readers accept newer events
Readers of the log SHALL skip events with a `type` that they do not know, and SHALL ignore fields that they do not know.

#### Scenario: Event from a newer plugin
- **WHEN** the log has an event with `type` `undo` between two `decision` events
- **THEN** the digest lists both decisions and no error is reported

### Requirement: Suggestion events
Each successful `suggest_edit` SHALL write one `suggestion` event with the ids of the new marks, the find text, the replace text, and the before and after text when the agent gave them. A refused suggestion SHALL NOT write an event.

#### Scenario: Replace logged
- **WHEN** the agent suggests `quick` → `slow` in `essay.md`, and the new marks have the ids `d1aaaa` and `i1bbbb`
- **THEN** one `suggestion` event has `ids` `["d1aaaa", "i1bbbb"]`, `find` `quick` and `replace` `slow`

#### Scenario: Refusal not logged
- **WHEN** the agent suggests a change whose find text is not in the note
- **THEN** the log does not change

### Requirement: Decision events
Each accept and each reject in Obsidian SHALL write one `decision` event with the mark `id`, its `kind` (`insertion` or `deletion`), the `decision` (`accepted` or `rejected`), the mark `content`, and the mark `author` when it has one. This SHALL also happen when no agent session runs and when the mark was not made by the agent. A failed write SHALL NOT block or undo the decision; the plugin SHALL show one notice about it.

#### Scenario: Accept with no session running
- **WHEN** no agent session runs, and the user accepts the insertion `{id="i1bbbb" author="Claude"++slow++}` in `essay.md`
- **THEN** a `decision` event has `id` `i1bbbb`, `kind` `insertion`, `decision` `accepted`, `content` `slow` and `author` `Claude`

#### Scenario: Mark typed by hand
- **WHEN** the user rejects the deletion `{--old--}`, which had no id
- **THEN** the `decision` event has the new id that the mark got in the same step

#### Scenario: Log cannot be written
- **WHEN** the log folder cannot be written and the user accepts a change
- **THEN** the note contains the accepted text
- **AND** a notice says that the log could not be written

### Requirement: Rename events
When a Markdown note in the vault is renamed or moved, also as part of a folder rename, the plugin SHALL write a `rename` event with `path` set to the new path and `from` set to the old path. Later events for that note SHALL use the new path.

#### Scenario: Note moved
- **WHEN** the user moves `essay.md` to `drafts/essay.md`, then accepts a change in it
- **THEN** a `rename` event has `from` `essay.md` and `path` `drafts/essay.md`
- **AND** the `decision` event after it has `path` `drafts/essay.md`

#### Scenario: Folder renamed
- **WHEN** the user renames the folder `drafts` to `old`, and `drafts/essay.md` is in it
- **THEN** a `rename` event has `from` `drafts/essay.md` and `path` `old/essay.md`

### Requirement: A mark is a note and an id
Readers SHALL identify a mark by its note path and its id together, and SHALL follow `rename` events to the current path. Two marks with the same id in different notes SHALL be different marks.

#### Scenario: Copied note
- **WHEN** the log has an `accepted` decision for `i1bbbb` in `essay.md` and a later `rejected` decision for `i1bbbb` in `copy.md`
- **THEN** `get_detail("i1bbbb", "essay.md")` reports `accepted`

### Requirement: The latest event for a mark wins
When the log has more than one `decision` event for the same mark, readers SHALL use the latest one.

#### Scenario: Decided again after undo
- **WHEN** the log has `accepted` for `i1bbbb` in `essay.md` with `seq` 5, and `rejected` for `i1bbbb` in `essay.md` with `seq` 9
- **THEN** `get_detail("i1bbbb")` reports the decision `rejected`

### Requirement: The log stays out of git
The plugin SHALL write `.coedit/local/.gitignore` with the line `*` when it is missing, so that git ignores all machine folders also when `coedit init` never ran.

#### Scenario: Git ignores the log
- **WHEN** the plugin runs in a vault that is a git repository, `coedit init` never ran, and the log has events
- **THEN** `git status` does not show any file below `.coedit/local/`
