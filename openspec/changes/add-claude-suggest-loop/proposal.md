# Proposal

## Why

The vision promises that "the agent only suggests", that the user "decides about each change", and that the agent "sees each decision on the next request". Changes 1, 2 and 12 built the mark format, the review in Obsidian and the e2e tests, but no agent is connected yet. This change closes slice 1: the smallest loop that works from end to end. Claude Code suggests a change, the change shows inline in Obsidian, the user accepts or rejects it, and the next prompt tells the agent what the user decided.

Facts about Claude Code that the design depends on were checked before this proposal, in the docs and with real runs of `claude` 2.1.310 (see design.md, "Checked facts"). They answer the roadmap's open checks on plugin activation and on the MCP SDK bundle.

This change is the base of all later changes. A red-team review (2026-10-25) checked it for consistency, for attacks and failure modes, and for the docs. Its results are in this version: one session id for each launcher run, a digest that never skips a decision, marks identified by note and id, machine-local state in a folder for each machine, and rules that let later changes add messages and events without breaking older parts.

## What Changes

- **Hub in the Obsidian plugin.** A WebSocket server on `127.0.0.1` with a random port and a token in `endpoint.json`. It checks the token in the first message, refuses browser origins and foreign `Host` headers, and checks the protocol version. It writes suggestions into notes: through the editor when the note is open (one undo step), with `vault.process` when it is closed. When the agent changes a note that is not the active note, a notice tells the user, for example `Claude suggested 2 changes in projects/plan.md`. A click on the notice opens that note.
- **Machine folder.** All machine-local state is in `.coedit/local/<machine>/`: `endpoint.json`, the log and the cursors. Synced vaults (Dropbox, iCloud, git) then never mix the state of two machines. The plugin writes `.coedit/local/.gitignore` (`*`), so git ignores it also without `coedit init`.
- **Event log.** One JSON Lines file for each machine, `.coedit/local/<machine>/log/events.jsonl`, with a rising `seq`, a log id, and a format version on each event. It holds `suggestion`, `decision` and `rename` events. The Obsidian plugin is the only writer. Each accept or reject in Obsidian is logged, also when no agent session runs. Readers identify a mark by its note and its id, and skip event types that they do not know.
- **Agent tools (MCP, stdio bridge `coedit mcp`).** `get_context` (active note, selection), `read_note` (agent view with the pending marks and their lines), `suggest_edit` (any note in the vault, explicit path), `get_detail` (the logged events of a mark), `get_digest` (the digest in the middle of a task). All positions are in the agent view. Tool errors carry a code from one list. If Obsidian is closed, the tools that need it return `hub_unavailable` ("Obsidian not connected"). A repeated call after a lost answer writes only once.
- **Digest.** It holds the user's decisions on agent suggestions since the last digest of this session, over all notes, with excerpts of up to 200 characters (the start and the end of a long change), and stays under a budget (default 8,000 characters, below Claude Code's 10,000 limit). When it is cut, it lists the decisions in log order, so none is skipped. A new session never gets the backlog from before it started: the note is the source of truth. A session is one run of `coedit claude`, with its own id and its own cursor. The `UserPromptSubmit` hook (`coedit inbox --digest --mark-read`) and `get_digest` use the same builder and the same cursor.
- **Claude plugin content.** The MCP config, the `UserPromptSubmit` hook, and an optional `co-editor` agent profile. The plugin sets no default agent.
- **`coedit claude` launcher.** It finds the vault: up from the current folder, else exactly one vault below it, else `--vault <path>`. It starts `claude` in the current folder with a temporary settings file. That file switches the plugin on for this session only and passes the vault path (`COEDIT_VAULT`), a new session id (`COEDIT_SESSION`) and the Node path (`COEDIT_NODE`). Ctrl+C in the session does not stop the launcher. On Windows it never starts `claude` through cmd.exe. `--agent [name]` starts a session with an agent profile.
- **`coedit init`** prepares a vault. It writes `config.json` (settings only), `.coedit/.gitignore` and the Obsidian plugin files. It also shows a deny rule that the user can copy into the project's `.claude/settings.json`.
- **BREAKING (plan only, no code yet): no note attachment and no guard hook.** The roadmap planned `note-attachment` and a `PreToolUse` guard. Both are dropped:
  - The agent's focus is Obsidian's active note.
  - The project's own Claude Code permissions own the hard blocks. `coedit init` only shows the rule.
  - "Suggest only" is a soft rule, carried by the tool descriptions and the agent profile. The docs say this clearly. Deny rules do not stop scripts that the agent runs. Only the Claude Code sandbox blocks at OS level.
- **Format follow-ups from change 1:**
  - (A) Refusals carry details: the match count for `ambiguous`, the zone kind for `protected_zone`, the mark ids for `overlaps_mark`. There is one error-code union for each function.
  - (B) More protected zones: `[[wikilinks]]`, callout markers `> [!note]`, and the CommonMark rule for backslashes in inline code (an escaped backtick does not open a span; inside a span a backslash is a normal character).
  - (D) Bundle tests for `coedit` with no arguments, an unknown option, and a stale bundle.
  - (C) CJK word boundaries stay open, for change 7. design.md records this decision.

Not in this change:
- Push on the user's click (change 4).
- The `comment` option of `suggest_edit`, which change 5 adds as the reason for a suggestion.
- The status bar list of notes with changes (change 6).
- File mode when Obsidian is closed (change 8).
- Detection of an undo of a decision, of an undo of a suggestion, or of a mark deleted by hand (change 9).
- An Obsidian command that starts the co-editor.
- More protected zones (link targets, math, `%%comments%%`, footnote refs, block ids, inline HTML), a line range for `read_note`, and log rotation. They are follow-ups in the roadmap.

## Capabilities

### New Capabilities

- `vault-hub`: the hub in the Obsidian plugin: endpoint file, token, origin and host check, protocol version, how a suggestion is written into an open or a closed note, the notice for other notes.
- `event-log`: the event log of each machine: file, log id, `seq`, event envelope and version, event types, rename, mark identity, one writer.
- `agent-tools`: the MCP tools as the agent sees them: names, inputs, results, positions, error codes, refusals, "Obsidian not connected", version mismatch, reconnect, repeated calls.
- `context-digest`: the digest: the session, content, which decisions it lists, budget and cut, excerpts, the cursor for each session, log reset, no backlog for a new session, hook behaviour.
- `claude-plugin`: the Claude Code plugin: off by default, MCP config, `UserPromptSubmit` hook, optional agent profile, self-contained.

### Modified Capabilities

- `coedit-cli`: new subcommands `init`, `claude`, `inbox` and `mcp` (vault discovery, temporary settings file with the session id, signals, Windows start without a shell, `--agent`, deny rule text).
- `change-decisions`: each accept and reject in Obsidian writes a `decision` event to the log.
- `markup-format`: more protected zones (wikilinks, callout markers), the backslash rule for inline code, and refusals that carry details.

## Impact

- **Code:**
  - `packages/protocol`: zod schemas for the hub messages and the log events, the tool error codes, the machine folder paths.
  - `packages/obsidian`: hub, log writer, notice, wiring of decisions to the log. New dependency `ws`, bundled.
  - `packages/bridge`: subcommands `init`, `claude`, `inbox` and `mcp`, the hub client, the log reader, the digest builder. New dependencies `@modelcontextprotocol/sdk` and `zod`.
  - `packages/format`: zones and error details.
  - `adapters/claude`: `.mcp.json`, `hooks/hooks.json`, `agents/co-editor.md`.
  - `packages/e2e`: new tests that drive `coedit mcp` against the real Obsidian.
- **Files in the vault:**
  - New: `.coedit/local/<machine>/` with `endpoint.json` (port, token, pid, host), `log/events.jsonl`, `log/log-id` and `cursors/<session>.json`; `.coedit/local/.gitignore` (`*`).
  - `config.json` holds only settings (`digestBudget`).
  - `.coedit/.gitignore` lists `local/`, `snapshots/`, `*.sock` and `*.lock`.
- **Docs** (design D18):
  - Now, with this proposal: `roadmap.md` (change 3, the items for changes 4 to 11, the new "Follow-ups from change 3", open checks, capabilities), `vision.md`, the rules in `CLAUDE.md`, and a banner on each `architecture*.md` file.
  - In apply (task group 11): the architecture files, `tech-stack.md`, `install.md`, `README.md`, `testing.md` and the rest of `CLAUDE.md`, and the results in `roadmap.md`.
