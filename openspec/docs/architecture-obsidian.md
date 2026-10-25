# MD-Coeditor architecture: Obsidian side

> **Note (2026-10-25):** This file still shows the plan before change 3 (`add-claude-suggest-loop`). Change 3 drops note attachment and the guard, uses one event log for each machine, a folder for each machine (`.coedit/local/<machine>/`) and a cursor for each session. Until task 11.2 of that change updates this file, its [design.md](../changes/add-claude-suggest-loop/design.md) wins on conflict.

Part of the architecture. The entry point is [architecture.md](architecture.md). The Claude side is in [architecture-claude.md](architecture-claude.md), the mark format in [architecture-format.md](architecture-format.md). Build and version rules for the plugin are in [tech-stack.md](tech-stack.md#obsidian-plugin).

The Obsidian plugin (`packages/obsidian`) has two parts:

- **Editor** (change 2, done): renders marks and lets the user accept and reject them.
- **Hub and log writer** (change 3, planned): the WebSocket server for the bridge, and the event log.

## Component diagram

Solid lines: done. Dashed lines: planned for change 3.

```mermaid
flowchart TB
  subgraph APP["Obsidian app"]
    direction TB
    MAIN["main.ts<br/>only file that imports obsidian:<br/>commands, editor menu, notices,<br/>post-processor"]

    subgraph EXT["coeditExtension (plain CodeMirror 6)"]
      direction TB
      MARKS["marks.ts<br/>state field: parse result"]
      RENDER["render.ts<br/>Live Preview decorations"]
      PROTECT["protect.ts / motion.ts<br/>edit filter, keymaps"]
      DECIDE["decide.ts / navigate.ts<br/>accept, reject, next, previous"]
    end

    READING["reading.ts<br/>Reading view post-processor"]

    subgraph HUBBOX["Hub (change 3)"]
      direction TB
      WS["WebSocket server<br/>127.0.0.1, random port, token"]
      TOOLS["Tool handlers<br/>read, suggest_edit"]
      LOGW["Log writer"]
    end
  end

  FORMAT[["packages/format"]]
  PROTO[["packages/protocol"]]
  NOTES["Notes .md"]
  EP[".coedit/endpoint.json"]
  LOG[".coedit/log/NOTE.jsonl"]
  CFG[".coedit/config.json"]
  BRIDGE["coedit mcp (bridge)"]

  MAIN --> EXT
  MAIN --> READING
  RENDER --> MARKS
  PROTECT --> MARKS
  DECIDE --> MARKS
  MARKS --> FORMAT
  DECIDE --> FORMAT
  READING --> FORMAT
  EXT <-->|"CodeMirror transactions"| NOTES

  MAIN -.->|starts on load| WS
  WS -.->|writes| EP
  BRIDGE -.->|"WebSocket client"| WS
  WS -.-> TOOLS
  TOOLS -.->|"suggest(), project()"| FORMAT
  TOOLS -.->|"messages"| PROTO
  TOOLS -.->|"edit open note"| EXT
  TOOLS -.-> LOGW
  DECIDE -.->|"decision events"| LOGW
  LOGW -.->|appends| LOG
  TOOLS -.->|reads| CFG
```

## Editor

From change 2 (`add-obsidian-review-basics`).

### Modules

All editor logic is plain CodeMirror 6 code in `packages/obsidian/src`, so it runs in jsdom tests. Only `main.ts` imports `obsidian`. It registers the extension, the commands, the editor menu and the Reading view post-processor, and it shows notices. It has no other logic.

| Module | Content |
|---|---|
| `marks.ts` | A state field with the parse result of the note (insertions, deletions, other kinds, duplicate ids). It parses the whole note on each document change. Also the injected `isLivePreview` check and the hidden ranges of a mark. |
| `render.ts` | Live Preview decorations: hidden syntax, the classes `coedit-ins` and `coedit-del` with an `aria-label` tooltip, atomic ranges. Nothing in Source mode. |
| `protect.ts`, `motion.ts` | Edit protection and cursor keys (see below). |
| `decide.ts`, `navigate.ts` | Accept and reject at the cursor or at the right-click position, next and previous change. Each returns a transaction spec or a notice text. |
| `reading.ts` | Reading view rendering. |
| `extension.ts` | All of the above as one extension: `coeditExtension({ isLivePreview })`. |

### Hidden syntax stays whole

- In Live Preview, the braces, operators and attributes of insertions and deletions are always hidden, also with the cursor inside. They are atomic ranges.
- A change filter applies to user edits only (`input`, `delete`, `move`). When an edit covers part of a mark, the filter keeps that mark's hidden ranges, so only the visible text changes. An edit that covers the whole mark removes it. File reloads and decisions are not user edits, so they pass.
- Keymaps (`Prec.high`) work on visible characters next to hidden syntax: Backspace and Delete delete the visible character on the other side, and Left and Right (also with Shift) move over one visible character with one key press. Without them, a key press at a mark edge does nothing that the user can see.
- A decision is one transaction with `filter: false`. A mark without an id, or with a duplicate id, gets a new id in the same transaction, so one undo gives back the exact text.

```mermaid
flowchart TD
  TX["Transaction"] --> UE{"User edit?<br/>input, delete, move"}
  UE -->|"no: file reload,<br/>decision (filter: false)"| PASS["Applied as it is"]
  UE -->|yes| COV{"Covers a mark?"}
  COV -->|"no"| PASS
  COV -->|"whole mark"| DEL["Mark removed"]
  COV -->|"part of a mark"| KEEP["Hidden ranges kept,<br/>only visible text changes"]
```

### Accept or reject a change

```mermaid
sequenceDiagram
  actor U as User
  participant M as main.ts
  participant D as decide.ts
  participant F as packages/format
  participant CM as CodeMirror view
  participant L as Log writer (change 3)

  U->>M: Right-click on a change, or command "Accept change"
  M->>D: decide at cursor or stored menu position
  D->>F: decide(text, id, accept or reject)
  F-->>D: Result: text, changes (ids fixed in the same result)
  D-->>M: transaction spec, or a notice text
  M->>CM: dispatch one transaction (filter: false)
  CM-->>U: mark gone, cursor kept, one undo restores it
  M--)L: decision event (planned)
```

### Right-click menu

Obsidian's `editor-menu` event does not give the mouse position. A `contextmenu` handler stores the start of the change span under the pointer (null when the pointer is not on a change span), and `editor-menu` adds "Accept change" and "Reject change" only for that position. A click on plain text next to a mark does not show the items. On macOS the menu is native by default, so the DOM does not show it. The end-to-end tests set `nativeMenus: false` in the fixture vault: the menu is then a DOM `.menu` on all systems, and the tests right-click, read the item titles and click an item (change 12, design D4). The plugin adds its items to Obsidian's `Menu` object in both cases, so the plugin code path is the same. The native display is Obsidian's code; one manual look at it stays in the manual list ([testing.md](testing.md)).

```mermaid
sequenceDiagram
  actor U as User
  participant DOM as Editor DOM
  participant M as main.ts
  participant MENU as Obsidian Menu

  U->>DOM: right-click
  DOM->>M: contextmenu event (has the mouse position)
  M->>M: store start of the change span under the pointer, or null
  DOM->>M: editor-menu event (no mouse position)
  alt a change span was stored
    M->>MENU: add "Accept change", "Reject change"
  else null
    M->>MENU: add nothing
  end
  MENU-->>U: menu (native on macOS, DOM in the e2e tests)
```

### Reading view

The post-processor collects the text nodes of a rendered section (not in `code`, `pre`, tables or frontmatter), joins them, and parses the joined text with `packages/format`. It adds a blank line between blocks, so no mark is found across two blocks. It then removes the hidden syntax from the text nodes and wraps the content in the same classes as in Live Preview. Formatting inside a mark stays. Reading view has no decisions.

### Speed

A key press parses the whole note. In a 1.13 MB note with 3,000 marks, this takes 12.6 ms on average, above the 8 ms target. A roadmap follow-up covers an incremental parse.

## Hub

Planned for change 3 (`add-claude-suggest-loop`). The change's design defines the details.

- The hub is a WebSocket server in the plugin, on `127.0.0.1` with a random port. It is the only network server in MD-Coeditor (see [Who is the server?](architecture.md#who-is-the-server)).
- On load it writes the port and a new token to `.coedit/endpoint.json`. The bridge reads this file each time it connects.
- The tool logic is in the hub, not in the bridge: read the note in the agent view, rebase, write the marks, write the log.
- The hub writes the notes, the log and `endpoint.json`. It never writes `cursor.json` (one writer for each file).

### Hub start

```mermaid
sequenceDiagram
  participant O as Obsidian
  participant P as Plugin (main.ts)
  participant H as Hub
  participant EP as .coedit/endpoint.json

  O->>P: onload
  P->>H: start
  H->>H: listen on 127.0.0.1, port 0 (random)
  H->>H: make a new token
  H->>EP: write port + token
  Note over H,EP: The bridge reads endpoint.json when it connects.<br/>A restart of Obsidian gives a new port and token.
  O->>P: onunload
  P->>H: close all connections, stop
```

### A suggestion from the agent

The bridge sends each tool call to the hub. The hub uses `packages/format` and writes into the note.

```mermaid
sequenceDiagram
  participant B as Bridge (coedit mcp)
  participant H as Hub
  participant F as packages/format
  participant CM as Editor of the note
  participant N as Note on disk
  participant L as Log writer

  B->>H: suggest_edit(note, find, replace, ...) + token
  H->>H: check token
  H->>F: suggest(current text, ...)
  alt error code (not_found, ambiguous, ...)
    F-->>H: refusal with code and message
    H-->>B: error, message as it is
  else ok
    F-->>H: text, changes, marks
    H->>CM: one transaction with the changes
    CM->>N: Obsidian saves the note
    H->>L: suggestion event per mark
    H-->>B: ok, ids of the new marks
  end
```

## Event log

Planned for change 3. One JSON Lines file for each note: `.coedit/log/<note path>.jsonl`. It holds `suggestion` and `decision` events with mark ids. The hub is its only writer. The digest reads it from disk, so the digest works when Obsidian is closed (see [architecture-claude.md](architecture-claude.md#digest)). Git ignores the log.
