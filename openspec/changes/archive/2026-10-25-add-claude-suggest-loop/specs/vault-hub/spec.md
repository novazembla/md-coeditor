# Spec Delta

## Purpose

The hub is the only network server of MD-Coeditor. It runs in the Obsidian plugin, accepts connections from the local bridge, and writes the agent's suggestions into notes, so that the user sees them inline at once.

## ADDED Requirements

### Requirement: The hub publishes its endpoint
When the plugin loads, the hub SHALL listen on `127.0.0.1` only, on a port that the system chooses, with a new random token of at least 128 bits. It SHALL write `endpoint.json` with `port`, `token`, `pid` and `host` (the machine name) into the machine folder `.coedit/local/<machine>/`, and create the folders when they are missing. It SHALL NOT listen on any other interface.

#### Scenario: Endpoint after load
- **WHEN** the plugin loads in a vault with no `.coedit/` folder, on the machine `work-mac`
- **THEN** `.coedit/local/work-mac/endpoint.json` exists and contains a `port` between 1024 and 65535, a `token` of at least 32 hexadecimal characters, the `pid` of the Obsidian process and the `host` `work-mac`
- **AND** a TCP connection to `127.0.0.1` on that port succeeds

#### Scenario: New token after a restart
- **WHEN** the plugin unloads and loads again
- **THEN** `endpoint.json` contains a different token than before

### Requirement: The endpoint file is safe
Readers SHALL never see a half-written `endpoint.json`: the hub SHALL write a temp file and rename it. On macOS and Linux, only the user SHALL be able to read the file (mode `0600`) from the moment it exists.

#### Scenario: File mode
- **WHEN** the plugin loads on macOS
- **THEN** the mode of `endpoint.json` is `0600`

### Requirement: The hub removes its endpoint on unload
When the plugin unloads, the hub SHALL close all connections, stop listening, and delete its `endpoint.json`, but only when the file still holds this hub's token.

#### Scenario: Plugin is switched off
- **WHEN** the user switches the plugin off in Obsidian's settings
- **THEN** `endpoint.json` does not exist
- **AND** a connection to the old port fails

#### Scenario: File of another hub
- **WHEN** `endpoint.json` holds a token of another hub, and the plugin unloads
- **THEN** `endpoint.json` still exists and is unchanged

### Requirement: Only clients with the token are served
A client SHALL send a `hello` message with the token as its first message, within 5 seconds. When the token is wrong or missing, when the first message is not `hello`, or when no `hello` comes in time, the hub SHALL close the connection without an answer to any request. The token SHALL NOT be read from the connection URL.

#### Scenario: Wrong token
- **WHEN** a client connects and sends `hello` with the token `0000`
- **THEN** the hub closes the connection
- **AND** the note files do not change

#### Scenario: Request before hello
- **WHEN** a client connects and sends a `suggest_edit` request as its first message
- **THEN** the hub closes the connection without an answer

#### Scenario: No hello
- **WHEN** a client connects and sends nothing for 5 seconds
- **THEN** the hub closes the connection

#### Scenario: Correct token
- **WHEN** a client sends `hello` with the token from `endpoint.json`, then a `get_context` request
- **THEN** the hub answers the request

### Requirement: The hub checks the protocol version
The hub SHALL answer a valid `hello` with `welcome`, its protocol version and a list of features. When the `hello` has another protocol major version, the hub SHALL send an error with the code `protocol_mismatch` and close the connection. The hub SHALL ignore message fields that it does not know.

#### Scenario: Matching version
- **WHEN** a client sends a valid `hello` with protocol 1
- **THEN** the hub answers `welcome` with protocol 1 and a `features` list

#### Scenario: Other version
- **WHEN** a client sends a valid `hello` with protocol 2
- **THEN** the hub sends an error with the code `protocol_mismatch` and closes the connection

### Requirement: Browser and foreign requests are refused
The hub SHALL refuse a connection request that has an `Origin` header, or whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`, before the `hello` message.

#### Scenario: Web page connects
- **WHEN** a connection request has the header `Origin: https://example.com`
- **THEN** the hub refuses the connection

#### Scenario: DNS rebinding
- **WHEN** a connection request has the header `Host: evil.example:<port>`
- **THEN** the hub refuses the connection

#### Scenario: Local client without a browser origin
- **WHEN** the bridge connects with no `Origin` header
- **THEN** the hub accepts the connection and waits for `hello`

### Requirement: Suggestions in an open note go through its editor
When the target note is open in an editor, the hub SHALL apply the suggestion to the editor text as one transaction in its own undo step. When the note is open in more than one editor, the hub SHALL use the editor of the active pane if it shows the note, else the editor that was focused last. One undo in that editor SHALL remove the suggestion, also when the user typed right after it. Obsidian's normal save SHALL write the note to disk. The cursor and the selection SHALL stay on the same text.

#### Scenario: Suggest into the open note
- **WHEN** `essay.md` is open with the text `The quick fox.` and the cursor after `fox`, and the agent suggests `quick` → `slow`
- **THEN** the editor shows the deletion `quick` and the insertion `slow`
- **AND** the cursor is still after `fox`
- **AND** after the save, the file on disk contains `{--quick--}` and `{++slow++}` marks with ids

#### Scenario: Undo removes the suggestion
- **WHEN** the agent has suggested `quick` → `slow` in the open note, and the user presses undo once in that editor
- **THEN** the note text is `The quick fox.` again

#### Scenario: Typing right after a suggestion
- **WHEN** the agent suggests `quick` → `slow` in the open note, the user types `!` at the end within half a second, and then presses undo two times
- **THEN** the first undo removes `!` and the second undo removes the suggestion

### Requirement: Suggestions in a closed note change the file in one step
When the target note is not open in any editor, the hub SHALL read, change and write the file in one atomic step through Obsidian's vault, so that no other change in between is lost.

#### Scenario: Suggest into a closed note
- **WHEN** `projects/plan.md` is not open and contains `Ship in May.`, and the agent suggests `May` → `June`
- **THEN** the file on disk contains a deletion mark with `May` and an insertion mark with `June`
- **AND** the rest of the file is unchanged

### Requirement: Notice for suggestions in another note
When a suggestion succeeds in a note that is not the active note, the hub SHALL show a notice with the number of new marks and the note path: `Claude suggested 1 change in <path>` for one mark, else `Claude suggested N changes in <path>`. A click on the notice SHALL open that note. No notice SHALL show for the active note.

#### Scenario: Suggestion in a background note
- **WHEN** `essay.md` is active, and the agent suggests `May` → `June` in `projects/plan.md`
- **THEN** a notice shows `Claude suggested 2 changes in projects/plan.md`
- **AND** a click on the notice opens `projects/plan.md`

#### Scenario: Suggestion in the active note
- **WHEN** `essay.md` is active, and the agent suggests a change in `essay.md`
- **THEN** no notice shows

### Requirement: Agent marks name the agent and the day
Marks that the hub creates for the agent SHALL have the author `Claude` and the local date of the day of the suggestion in the form `YYYY-MM-DD`.

#### Scenario: Author and date
- **WHEN** the agent suggests `quick` → `slow` on 2026-10-25
- **THEN** both new marks have `author="Claude"` and `date="2026-10-25"`
