# Scratchpad: explore `add-claude-suggest-loop` (change 3)

Temporary notes from the explore session (2026-10-25). Not a spec. Delete after the proposal exists.
Source of the plan: openspec/docs/roadmap.md (change 3), architecture.md, tech-stack.md, initial-plan.md.

## State of the code (start of change 3)

- Done: packages/format (parse, suggest, decide, project, ids), packages/obsidian (render, accept/reject, menu, navigate, reading), packages/e2e (wdio, docker).
- Missing: packages/protocol is empty (`export {}`). No hub, no log, no `ws` in the plugin. packages/bridge has an empty subcommand registry (only `--help`, `--version`). adapters/claude has only `.claude-plugin/plugin.json` (`defaultEnabled: false`), no `.mcp.json`, hooks or agent.

## Confirmed decisions

1. **One change**, no split into 3a/3b/3c.
2. **No note attachment.** The `note-attachment` capability is dropped. No attached list in config.json.
3. **Focus = Obsidian's active note + selection.** "Active" means Obsidian's active file (last focused pane, kept while the user is in the terminal). Reported to the agent by `get_context` and in the digest header.
4. **Permissions and protection are owned by the project** (`.claude/settings.json`, `.claude/settings.local.json`), not by the launcher and not by a guard hook. The agent may also work with non-md files.
   - Option c: the agent definition says "change notes only through `suggest_edit`" (soft). `coedit init` SHOWS a suggested deny snippet for the vault notes; it writes nothing to `.claude/`.
   - No PreToolUse guard, no `coedit guard` subcommand.
   - Vision line to adapt: "The agent suggests. Hard blocks come from the project's own Claude Code permissions."
   - Slice 1 e2e step 5 becomes: "with the documented project rule, a direct Edit is blocked".
5. **config.json** keeps only committed settings (author name, digest budget). `coedit init` is the only writer. (Proposed, follows from 2; not explicitly confirmed.)
6. **Start folder of `coedit claude`: option C.** Start `claude` in the current folder. Find the vault: walk up for `.obsidian/`; else exactly one vault below; else require `--vault <path>`. The launcher passes the vault path to the MCP server and the hook via an environment variable.
7. **MCP tools (slice 1):**
   - `get_context`: active note path, selection (text + position), hub connected, open-mark count of the active note.
   - `read_note(path)`: agent view (as if all pending marks were accepted), mark ids where useful. Any note.
   - `suggest_edit(path, find, replace, before?, after?)`: any note in the vault (explicit path). No `rationale`.
   - `get_detail(id)`: the full logged event for a mark id (before, after, decision, date).
   - `get_digest`: the agent pulls the digest mid-task. Same builder and cursor as the hook.
   - Not in slice 1: `get_inbox`, `comment`, `reply`, `finish`.
8. **Change 5 (`add-substitution-and-comments`)** adds a `comment` option to `suggest_edit` (the reason becomes a comment on the change). Update the roadmap row of change 5.
9. **Write path:** the hub (in Obsidian) writes. Open note: CodeMirror transaction in that editor (cursor kept, one undo removes the suggestion). Closed note: `vault.process`. Obsidian's normal save cycle is enough (no forced save). Obsidian closed: "Obsidian not connected" (slice 1, no file mode).
10. **Suggestions are always written into the note** (the note is the source of truth). Sidecar store rejected. Accepted costs: other readers of .md (docs builds) see raw marks; sync and git noise. Later: warning for notes with open marks.
11. **Notice on arrival:** a suggestion in a non-active note shows `Claude suggested 2 changes in projects/plan.md` (clickable, opens the note). Needs an e2e test.
12. **Status bar "notes with changes" list moves to change 6** (`add-review-panel`). Update the roadmap row of change 6.
13. **Digest:** one digest per prompt, covering ALL notes with new decisions since the last digest (document-centric stays for focus, not for the digest). The prompt is the trigger that sends the batch; no small events to the agent.
    - Items: decisions only (id, kind, accepted/rejected, excerpt). Excerpt up to 200 characters, cut in the middle; `get_detail(id)` for full text.
    - Header: `Active note: essay.md` when the hub answers within a short timeout; left out otherwise. The hook never blocks the prompt and exits 0 on hub errors.
    - Later item type: comments to the agent (change 5/11).
14. **Three delivery paths, one builder, one cursor (`cursor.json`, one cursor per note):**
    1. user prompt in the CLI: `UserPromptSubmit` hook, `coedit inbox --digest --mark-read` (slice 1);
    2. user clicks "send" in Obsidian: push of a SHORT pointer through a Claude channel ("3 new decisions, call get_digest"), change 4, spike S2;
    3. agent calls `get_digest` mid-task (slice 1).
15. **"Sent" bookkeeping:** the cursor is the only record (option a). No `delivery` log event in slice 1. Change 4 lets the hub READ `cursor.json` to know what is unsent.
16. **Follow-ups from change 1 taken in change 3:** A error details (match count for `ambiguous`, zone kind for `protected_zone`, one error-code union per function); B more protected zones (`[[wikilinks]]`, callout markers `> [!note]`, backslash-escaped backticks); D coedit-cli bundle tests (no args, unknown option, stale-bundle check). Adds `markup-format (modified)` to the capabilities.
17. **CJK word boundaries (follow-up C):** record a decision in design.md: not in slice 1, stays an open follow-up (`Intl.Segmenter` is the likely fix).
18. **Launcher passes one temp settings file** (from facts 1, 2, 5, 8): `claude --settings <tempfile> [--plugin-dir <dir>]`. The file holds `enabledPlugins` (`md-coeditor@<marketplace>` or `md-coeditor@inline`) and `env.COEDIT_VAULT`. No inline JSON (Windows quoting). The bridge and the hook treat an unset or literal `${COEDIT_VAULT}` value as "not set".
19. **Digest budget below 10,000 characters** (fact 3): default about 8,000, then a line `+N more decisions: call get_digest`. The hook's hub call has a short timeout (Claude Code drops hook output after 30 s).
20. **Agent profile is optional** (fact 4): the plugin sets NO default agent (`settings.agent` not used). The plugin ships an optional `co-editor` agent profile. `coedit claude --agent [name]` passes `--agent <name>` through (default name `md-coeditor:co-editor`; the user can give their own profile). A profile replaces the Claude Code system prompt (accepted by the user). Without a profile, the MCP server `instructions` and the tool descriptions carry the "change notes only through `suggest_edit`" rule.
21. **Protection is soft, and the docs say so** (fact 7): project deny rule example `"Edit(/notes/**/*.md)"` (one `Edit` rule covers Write, MultiEdit, NotebookEdit). Deny rules do not stop scripts that the agent runs; only the Claude Code sandbox blocks at OS level. No guard hook (it would not see script writes either). `coedit init` text and docs state this.
23. **One event log for the vault** (replaces the per-note logs): `.coedit/log/events.jsonl`, each event has a rising `seq`. A rename is an event (`rename`, from, to); later events use the new path. Changes decision 14 (no per-note cursor).
24. **Undo after a decision: known gap in slice 1.** Rule: the latest event for an id wins. `read_note` shows the true note. TODO for change 9 (`add-external-changes`): detect undo of a decision and log it.
25. **Undo of a suggestion, or a mark deleted by hand: not logged in slice 1.** TODO for change 9: detect and log it (neither accepted nor rejected).
26. **No backlog for a new session (confirmed).** The note is the source of truth; a new session starts from the notes as they are. The log records every decision, also decisions made while no session runs (local history for analysis and change 9), but a digest never delivers events from before the session started. The cursor is one per session: `cursor.json` = `{ "<session id>": <last seq sent> }`. The bridge sets a missing entry to the current log end when it starts. The hook and `get_digest` move it. This also gives each of several sessions its own digest. Old entries are removed after about 30 days. Check in apply: does `claude --resume` keep the session id?
27. **Hub auth:** the token is in the bridge's first message (not in the URL), compared in constant time; a wrong token closes the connection.
28. **Origin check:** the hub refuses connections with a browser `Origin` (`http:`, `https:`). Check in apply what the Node global `WebSocket` sends.
29. **Reconnect:** the bridge connects on demand. On a failed call it reads `endpoint.json` again and tries once more, then returns "Obsidian not connected". The hub deletes `endpoint.json` on unload.
30. **`get_context` without an active note or without Obsidian:** not an error; returns `{ hubConnected, activeNote: null, selection: null }`.
31. **Several vaults open:** each vault has its own plugin instance, hub and `endpoint.json`. No extra design.
32. **Log event envelope:** `{ seq, ts, type, path, id, actor: "user" | "agent", agent?: "claude", session? }`. The bridge passes `CLAUDE_CODE_SESSION_ID` with each call. User decisions have no session.
33. **Test strategy:**
    - vitest: hub in Node with a fake WebSocket client (auth, origin, routing); bridge with a fake hub (reconnect, not connected); digest builder (budget, excerpt, "+N more"); log reader and cursor; launcher arguments and temp settings file (macOS and Windows paths); follow-ups A, B, D.
    - e2e in Docker: the test starts `coedit mcp` as a child process and drives it with the MCP SDK client against the real Obsidian: suggest, marks in the note, accept and reject, `coedit inbox --digest`, notice on arrival, `get_context`.
    - Manual list (needs a real `claude` with login): full launcher run, a direct Edit blocked by the documented project rule, plain `claude` has no co-editor tools, Windows start.
34. **No rebase in slice 1** (design.md says so): open note = `suggest()` on the live editor text and dispatch in the same tick; closed note = `vault.process`. Rebase comes with flows that wait (changes 8, 9).
22. **Architecture docs split** (done during explore, accepted state, not the change-3 design): `architecture.md` (entry) + `architecture-obsidian.md` + `architecture-claude.md` + `architecture-format.md`, with Mermaid component and sequence diagrams. Change 3 updates these files with decisions 2-21.

## Expected capabilities (to confirm in the proposal)

- Added: `vault-hub`, `event-log`, `agent-tools`, `context-digest`, `claude-plugin` (smaller: MCP config, UserPromptSubmit hook, agent definition).
- Modified: `coedit-cli` (init, claude, inbox, mcp), `change-decisions` (decisions are logged), `markup-format` (protected zones, error details).
- Dropped vs roadmap: `note-attachment`.

## Docs to update in the same change

- roadmap.md: change 3 row and capabilities (drop note-attachment, add markup-format), change 5 note (`comment` option), change 6 note (status bar list), follow-ups table (A, B, D taken; C decided "later"), capabilities table.
- architecture.md: no PreToolUse guard; hook only for the digest; config.json writer; attachment removed; focus = active note; start folder + vault discovery; three delivery paths.
- tech-stack.md: Claude plugin layout (no guard), launcher (no deny rules in `--settings`).
- vision.md: "suggest only" wording (hard blocks from project permissions); "document-centric" principle (focus).
- install.md: `coedit init` shows a deny snippet; `coedit claude` start folder and `--vault`.
- CLAUDE.md: "guard blocks Edit/Write on attached notes" is wrong now.

## Open questions

- None. All decisions are made (1-34). Next: `/opsx:propose add-claude-suggest-loop`.

## Roadmap additions for the proposal

- Change 9 (`add-external-changes`): TODO detect undo of a decision (decision 24); TODO detect undo of a suggestion and marks deleted by hand (decision 25).

## Claude Code facts (checked 2026-10-25)

Checked with docs research (code.claude.com docs) and a local try (claude 2.1.310, Node 24.22.1, @modelcontextprotocol/sdk 1.32.2, zod 4.6.7, esbuild 0.28.2; temp folder `/tmp/coedit-try-Q5TB`). Put these into design.md as facts.

| # | Fact | Result | Source |
|---|---|---|---|
| 1 | `defaultEnabled: false` stays off; `--settings` `enabledPlugins` turns it on for one session | CONFIRMED. Inline JSON and a file path both work. No settings file is written. `--settings` is the "flag" source: above user/project/local, below managed; merge per plugin id. A `defaultEnabled` in the marketplace entry overrides plugin.json (keep both `false`). Managed `false` cannot be overridden. | docs + run |
| 2 | `--plugin-dir` id | CONFIRMED: `<manifest name>@inline` (`md-coeditor@inline`). Wrong id: not loaded. Marketplace id: `<name>@<marketplace>` (run in isolated `CLAUDE_CONFIG_DIR`; model call not tested, no login). An enabled `--plugin-dir` copy replaces an installed plugin of the same name. `CLAUDE_CODE_PLUGIN_DIRS` env = same as the flag. | docs + run |
| 3 | UserPromptSubmit output | CONFIRMED: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`; plain stdout on exit 0 also works. Shown as a system reminder with the hook name. Limit about 10,000 characters per value; above it the model gets a file path + 2 KB preview (tested: 9,950 complete, 10,150 cut). Default hook timeout 30 s; on timeout the output is dropped. Hook also fires on `/loop`, background subagent reports, messages from other sessions. Hook stdin keys: `session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, prompt`. | docs + run |
| 4 | Agent activation | `claude --agent md-coeditor:co-editor` (short name works if unique), or `settings.agent` (plugin.json `"settings":{"agent":...}` or plugin-root `settings.json`). Precedence: `--agent` > user `agent` > plugin default. Same behaviour in all cases: the agent prompt REPLACES the Claude Code system prompt. Plugin agents ignore `permissionMode`, `hooks`, `mcpServers` frontmatter. | docs |
| 5 | Env var to MCP server and hook | CONFIRMED: inherited by both; `${VAR}` and `${VAR:-default}` expansion in plugin `.mcp.json` (command, args, env); `--settings {"env":{...}}` also reaches both. Unset var: `${VAR}` stays literal text (with a warning). Claude Code sets `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDECODE=1`; cwd = project folder. Exceptions: `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1` (MCP gets a baseline env only), `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`. | docs + run |
| 6 | MCP SDK one-file ESM bundle | CONFIRMED with the bridge build options (esm, node24, shebang + createRequire banner): 0 warnings, 1.36 MB (731 KB minified), runs alone without node_modules, `initialize`/`tools/list`/`tools/call` OK, Claude Code starts it. | run |
| 7 | Deny snippet | Gitignore-style: `//abs`, `~/`, `/x` (relative to settings source, for project settings the project root), `x` or `./x` (current folder). One `Edit(...)` rule covers Write, MultiEdit, NotebookEdit (`Write(...)` path rules never match). MCP tools by name only: `mcp__plugin_md-coeditor_<server>__<tool>`. Example: `{"permissions":{"deny":["Edit(/notes/**/*.md)"]}}`. Deny rules do NOT stop scripts that the agent runs (only the sandbox does). | docs |
| 8 | Windows | Native installer: `%USERPROFILE%\.local\bin\claude.exe`; npm: `claude.cmd` (Node needs `shell: true` to spawn a `.cmd`). `--settings` accepts a file path (regular file, max 2 MiB). Inline JSON quoting: not documented, so use a file. Still a manual check. | docs |

Side effect of the local try: empty folder `~/.claude/plugins/data/coedit-try-inline` (can be deleted). `~/.claude/settings.json` unchanged.

## Next step

1. Discuss the open questions above.
2. `/opsx:propose add-claude-suggest-loop`.
