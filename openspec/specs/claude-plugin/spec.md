# claude-plugin Specification

## Purpose

The Claude Code plugin `md-coeditor` brings the co-editor parts into a Claude Code session: the MCP tools, the digest hook and an optional agent profile. It is on only in sessions that the user starts for the co-editor.

## Requirements

### Requirement: Off unless the launcher switches it on
The plugin SHALL have `defaultEnabled: false` in its manifest and in its marketplace entry. A `claude` session that the user starts without `coedit claude` SHALL NOT have the co-editor tools or the digest hook, also when the plugin is installed.

#### Scenario: Plain claude session
- **WHEN** the plugin is installed at user scope and the user starts `claude` in the vault
- **THEN** the session has no tool whose name contains `md-coeditor`
- **AND** a prompt gets no MD-Coeditor digest

#### Scenario: Started by the launcher
- **WHEN** the user starts the session with `coedit claude`
- **THEN** the session has the tools `get_context`, `read_note`, `suggest_edit`, `get_detail` and `get_digest` of the plugin's MCP server

### Requirement: The plugin starts the MCP server
The plugin SHALL declare one stdio MCP server that runs `coedit mcp` from the plugin's own copy of `coedit.mjs`, with the Node program in `COEDIT_NODE`, else `node`. The server's own `env` SHALL pass `COEDIT_VAULT` and `COEDIT_SESSION`, so that they arrive also when Claude Code gives MCP servers only a base environment.

#### Scenario: Server in the session
- **WHEN** a session runs with the plugin on
- **THEN** the MCP server of the plugin is connected, and its tools have the prefix `mcp__plugin_md-coeditor_`

#### Scenario: Server config
- **WHEN** a test reads `.mcp.json` of the plugin
- **THEN** the server command is `${COEDIT_NODE:-node}`, and its `env` names `COEDIT_VAULT` and `COEDIT_SESSION`

### Requirement: The plugin runs the digest hook
The plugin SHALL declare one `UserPromptSubmit` hook that runs `coedit inbox --digest --mark-read` from the plugin's own copy of `coedit.mjs` with `node`, with a timeout of at most 10 seconds.

#### Scenario: Prompt after a decision
- **WHEN** a session runs with the plugin on, the user accepts a change in Obsidian, and then types a prompt
- **THEN** the model gets the digest with that decision as context for the prompt

### Requirement: Optional agent profile
The plugin SHALL ship the agent profile `co-editor`. It SHALL NOT make any agent the default for a session. The profile SHALL tell the agent to change vault notes only with `suggest_edit`, to start from `get_context`, to read the digest, to use `get_detail` before it suggests the same text again, and not to call `get_digest` in subagents. The profile SHALL NOT give the agent the `Edit`, `Write` or `Bash` tools.

#### Scenario: Default session
- **WHEN** the user starts `coedit claude` without `--agent`
- **THEN** the session runs Claude Code's normal main agent

#### Scenario: Profile on request
- **WHEN** the user starts `coedit claude --agent`
- **THEN** the session runs the agent `md-coeditor:co-editor` as its main agent

### Requirement: The plugin is self-contained
The plugin folder SHALL contain everything that it runs. It SHALL NOT refer to files outside its folder, and SHALL NOT have a `bin/` folder.

#### Scenario: Plugin folder alone
- **WHEN** the plugin folder is copied alone to another place, and loaded with `--plugin-dir`
- **THEN** the MCP server starts and `tools/list` succeeds
