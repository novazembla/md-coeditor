# Spec Delta

## Purpose

The agent tools are the MCP tools that the co-editor agent uses to see the user's focus, read notes, suggest changes and learn the user's decisions. They are the agent-neutral contract between any agent and MD-Coeditor.

## ADDED Requirements

### Requirement: The tool set
The MCP server `coedit mcp` SHALL offer exactly these tools: `get_context`, `read_note`, `suggest_edit`, `get_detail` and `get_digest`. Its server instructions SHALL tell the agent to change vault notes only with `suggest_edit`.

#### Scenario: Tool list
- **WHEN** an MCP client sends `tools/list` to `coedit mcp`
- **THEN** the answer lists exactly `get_context`, `read_note`, `suggest_edit`, `get_detail` and `get_digest`

#### Scenario: Server instructions
- **WHEN** an MCP client sends `initialize` to `coedit mcp`
- **THEN** the `instructions` in the answer contain `suggest_edit` and say that the agent does not edit vault notes directly

### Requirement: Tool errors have a code
A tool error SHALL be an MCP error result whose text is JSON with `code`, `message` and, when there are any, `details`. The codes SHALL come from one list: `hub_unavailable`, `protocol_mismatch`, `invalid_path`, `note_not_found`, `unknown_id`, `ambiguous_id`, and the refusal codes of the mark format.

#### Scenario: Error shape
- **WHEN** the agent calls `read_note("../secrets.md")`
- **THEN** the result is an error, and its text parses as JSON with `code` `invalid_path` and a `message`

### Requirement: Positions are in the agent view
Every line and column that a tool returns SHALL be a position in the agent view of the note (the text that `read_note` returns). Lines SHALL start at 1. Columns SHALL start at 0 and count UTF-16 code units. The agent view SHALL use `\n` as the line end, also when the note file uses `\r\n`.

#### Scenario: Selection after a pending deletion
- **WHEN** line 3 of `essay.md` is `The {--very--} quick fox.` and the user selects `quick`
- **THEN** `get_context` returns the selection text `quick`, starting at line 3, column 4

#### Scenario: Note with Windows line ends
- **WHEN** `plan.md` on disk has `\r\n` line ends and is not open
- **THEN** `read_note("plan.md")` returns a text without `\r`

### Requirement: Get the user's focus
`get_context` SHALL return `hubConnected`, `activeNote` (the vault-relative path of Obsidian's active Markdown note, or null), `selection` (the selected text of the agent view with its start and end line and column, or null when nothing is selected), and `openMarks` (the number of pending insertions and deletions in the active note, or null when there is no active note). When Obsidian is not connected, it SHALL return `hubConnected: false` with the other values null, and not an error.

#### Scenario: Active note with a selection
- **WHEN** `essay.md` is active in Obsidian with the words `quick fox` selected on line 3, and the note has 2 pending marks
- **THEN** `get_context` returns `hubConnected: true`, `activeNote: "essay.md"`, a `selection` with the text `quick fox` and line 3, and `openMarks: 2`

#### Scenario: No active note
- **WHEN** Obsidian runs but no Markdown note is open
- **THEN** `get_context` returns `hubConnected: true`, `activeNote: null`, `selection: null` and `openMarks: null`

#### Scenario: Obsidian closed
- **WHEN** Obsidian is not running
- **THEN** `get_context` returns `hubConnected: false`, `activeNote: null`, `selection: null` and `openMarks: null`

### Requirement: Read a note in the agent view
`read_note(path)` SHALL return the agent view of the note (the text as if all pending marks were accepted), and the list of pending insertions and deletions with `id`, `kind`, `author`, `content` and `line` (the line of the agent view where the mark is). For an open note, it SHALL use the editor text, also when it is not saved yet.

#### Scenario: Note with a pending replace
- **WHEN** `essay.md` contains `The {--quick--}{++slow++} fox.` on line 1, with ids `d1aaaa` and `i1bbbb`
- **THEN** `read_note("essay.md")` returns the text `The slow fox.`
- **AND** the list has a deletion `d1aaaa` with content `quick` and an insertion `i1bbbb` with content `slow`, both on line 1

#### Scenario: Unsaved editor text
- **WHEN** the user typed `Hello` into the open note `essay.md`, and Obsidian has not saved it yet
- **THEN** `read_note("essay.md")` contains `Hello`

### Requirement: Note paths are checked
`read_note` and `suggest_edit` SHALL accept only a vault-relative path of an existing `.md` file inside the vault, with `/` as the separator. Otherwise they SHALL refuse with the code `invalid_path` (absolute path, drive letter, leading `/`, `\`, `.` or `..` segment, not `.md`) or `note_not_found` (no such note), and change nothing.

#### Scenario: Path outside the vault
- **WHEN** the agent calls `read_note("../secrets.md")`
- **THEN** the tool refuses with the code `invalid_path`

#### Scenario: Windows path
- **WHEN** the agent calls `read_note("C:\\notes\\essay.md")`
- **THEN** the tool refuses with the code `invalid_path`

#### Scenario: Missing note
- **WHEN** the agent calls `suggest_edit` with the path `nope.md`, and the vault has no such note
- **THEN** the tool refuses with the code `note_not_found`

### Requirement: Suggest a change
`suggest_edit(path, find, replace, before?, after?)` SHALL turn the change into marks in the note at `path`, by the rules of the mark format. Any note in the vault MAY be the target. A successful result SHALL contain the path and the ids of the new marks.

#### Scenario: Successful suggestion
- **WHEN** `essay.md` contains `The quick fox.` and the agent calls `suggest_edit("essay.md", "quick", "slow")`
- **THEN** the result contains the path `essay.md` and two new mark ids
- **AND** the note contains a deletion of `quick` and an insertion of `slow`

### Requirement: A repeated call writes once
When the bridge repeats a `suggest_edit` call after a lost answer, the note SHALL change only once, and both calls SHALL get the same result. This SHALL also hold when the repeat arrives while the first call still runs.

#### Scenario: Answer lost after the write
- **WHEN** the hub writes a suggestion, the connection breaks before the answer arrives, and the bridge repeats the call after a reconnect
- **THEN** the note has the marks of one suggestion
- **AND** the agent gets one successful result with their ids

### Requirement: Refusals reach the agent unchanged
When the format refuses a suggestion, `suggest_edit` SHALL return a tool error with the refusal code, the message of the format, and its details, and SHALL NOT change the note.

#### Scenario: Ambiguous find text
- **WHEN** `essay.md` contains `a cat and a cat` and the agent suggests `cat` → `dog`
- **THEN** the tool error has the code `ambiguous` and the match count 2
- **AND** the note does not change

#### Scenario: Find text touches a pending mark
- **WHEN** `essay.md` contains `The {--quick--}{++slow++} fox.` with ids `d1aaaa` and `i1bbbb`, and the agent suggests `slow fox` → `fast fox`
- **THEN** the tool error has the code `overlaps_mark`, and the ids in its details contain `i1bbbb`

### Requirement: Tools that need Obsidian say so
When Obsidian is not running, or the hub cannot be reached, `read_note` and `suggest_edit` SHALL return the tool error `hub_unavailable` with the message `Obsidian not connected`. `get_detail` and `get_digest` SHALL still work, because they read the log from disk.

#### Scenario: Suggest with Obsidian closed
- **WHEN** Obsidian is not running and the agent calls `suggest_edit`
- **THEN** the tool returns the error `hub_unavailable` with the message `Obsidian not connected`
- **AND** no file changes

#### Scenario: Digest with Obsidian closed
- **WHEN** Obsidian is not running and the log has a new decision for this session
- **THEN** `get_digest` returns a digest with that decision

### Requirement: Versions that do not match say so
When the hub refuses the bridge because the protocol versions do not match, the tools that need Obsidian SHALL return the tool error `protocol_mismatch` with a message that tells the user to update the Obsidian plugin or `coedit`.

#### Scenario: Old bridge, new plugin
- **WHEN** the hub speaks protocol version 2 and the bridge sends `hello` with version 1
- **THEN** `read_note` returns the error `protocol_mismatch`, and its message contains `update`

### Requirement: Reconnect after an Obsidian restart
When a call to the hub fails, the bridge SHALL read `endpoint.json` again and try one more time, before it reports `hub_unavailable`. A restart of Obsidian SHALL NOT need a restart of the agent session.

#### Scenario: Obsidian restarted during a session
- **WHEN** the agent called `get_context` successfully, then Obsidian restarts with a new port and token, and the agent calls `get_context` again
- **THEN** the second call returns `hubConnected: true`

### Requirement: Get the history of a mark
`get_detail(id, path?)` SHALL return the note path, the mark id, all log events of that mark in log order, and `current`: the latest decision (`accepted` or `rejected`), or `pending` when there is none. A mark is a note path and an id; renames are followed. When the id names marks in more than one note and no `path` is given, it SHALL refuse with the code `ambiguous_id` and list the paths in its details. For an id that the log does not know, it SHALL refuse with the code `unknown_id`.

#### Scenario: Suggested and accepted
- **WHEN** the log has a `suggestion` event in `essay.md` with the id `i1bbbb` and a later `decision` event `accepted` for it
- **THEN** `get_detail("i1bbbb")` returns the path `essay.md`, both events, and `current` `accepted`

#### Scenario: Same id in two notes
- **WHEN** the log has events for the id `i1bbbb` in `essay.md` and in `copy.md`
- **THEN** `get_detail("i1bbbb")` refuses with the code `ambiguous_id`, and its details list `essay.md` and `copy.md`
- **AND** `get_detail("i1bbbb", "copy.md")` returns only the events in `copy.md`

#### Scenario: Unknown id
- **WHEN** the agent calls `get_detail("zzzzzz")` and no event names this id
- **THEN** the tool refuses with the code `unknown_id`

### Requirement: Get the digest during a task
`get_digest` SHALL return the same digest that the next prompt would get, and SHALL move this session's cursor, so that the next prompt does not repeat it. When nothing is new, it SHALL return `No new decisions.` Its description SHALL say that it is for the main conversation, not for subagents.

#### Scenario: Pull in the middle of a task
- **WHEN** the user accepted one agent suggestion since the last digest of this session, and the agent calls `get_digest`
- **THEN** the result lists that decision
- **AND** the digest on the next prompt does not list it again

#### Scenario: Nothing new
- **WHEN** no decision happened since the last digest of this session
- **THEN** `get_digest` returns `No new decisions.`
