> **Frozen, partly old.** This is the initial plan from 2026-10-24, before the first OpenSpec change. Do not update it. When it disagrees with the other files in `openspec/docs/`, the other files win. For the purpose and value of the product, see [vision.md](vision.md). For the current order and status of the work, see [roadmap.md](roadmap.md). For the decisions that changed this plan, see [architecture.md](architecture.md) and [tech-stack.md](tech-stack.md).

# md-coeditor — Word-like co-editing in Obsidian with an interactive agent CLI (CLI: `coedit`)

## Context
super-coach (VS Code/TipTap fork + interactive `claude` + MCP + hooks) loses pending suggestions on reload, gives the
agent no accept/reject feedback and hides changes in a sidebar. The two reference projects — obsidian-track-changes
(philphilphil, MIT) and claude-plugin-obsidian-track-changes-agent (John Randall, MIT) — show a file-persistent
CriticMarkup approach with Obsidian as review UI, but have no UI→agent path (their "watch" is a 10s-polling background
job that exits and is re-armed, ~30s latency, file edits only).
Goal: a **new, own project**: an agent-neutral backend plus an own Obsidian plugin, giving a Word-like Track Changes
experience with bidirectional, manually triggered, token-frugal interaction with an *interactive* agent CLI session
(Claude Code first, Codex next). Existing code is a quarry only — no dependency on, or fork-tracking of, upstream.

## Principles (decided)
- Interactive agent CLI in a separate terminal. No `claude -p`, no API/SDK.
- **Every agent interaction is manually triggered** (button/command in Obsidian, or a prompt typed in the terminal).
  No auto-wake, no debounce timers, no auto-send. External changes → banner only.
- Agent is **suggest-only**: every agent change is a tracked suggestion; direct edits to attached notes are blocked.
- Desktop only. Live Preview fidelity is enough (raw syntax on focused line/block).
- Activation only via launcher — never loaded in unrelated sessions.
- One co-editor session per vault; notes are attached explicitly.
- Track Changes works **without** a live session: one **per-vault** UI toggle (status bar + panel + command/hotkey),
  stored in the plugin's `data.json` (which Obsidian keeps per vault). When on, edits to existing notes are tracked
  (new files excepted). Notes stay clean; existing marks render regardless of the toggle.
- Note frontmatter is not used by md-coeditor and is **excluded** from tracking and from agent suggestions
  (marks inside YAML would break it); edits there, incl. via the Properties UI, pass through untracked.
- New files are not tracked (only mentioned, compressed, in the digest).
- Token frugality: compressed digests, details on demand, one intent in flight at a time.

## Repo layout (repo folder `md-coeditor`; pnpm workspaces, TypeScript)
- `packages/format` — CriticMarkup dialect, parser, edit ops, rebase, tracking transforms (pure, no Obsidian deps).
- `packages/obsidian` — Obsidian plugin (UI + hub).
- `packages/server` — stdio MCP server spawned by the agent; also the `coedit` CLI (inbox digest, launcher).
- `adapters/claude` — agent definition, hook settings, channel flags, PreToolUse guard.
- `adapters/codex` — AGENTS.md/skill snippet, MCP config (after spike).
- Later (design must not preclude): `adapters/gemini` (MCP + `BeforeAgent` hook), `adapters/pi` (Pi extension).
- Tool logic lives in a transport-agnostic core in `packages/server`; exposed via MCP stdio (Claude, Codex, Gemini)
  and natively via a Pi extension (`pi.registerTool`), which also connects to the hub itself.

## Agent capability matrix (researched 2026-10-24)
| Agent | Pull (digest on typed prompt) | Push (on your click) | Tools |
|---|---|---|---|
| Claude Code | `UserPromptSubmit` hook | channels (research preview, dev flag) | MCP |
| Codex ≥0.149 | `UserPromptSubmit` hook (additionalContext) | `codex queue --remote` vs own app-server (spike S3) | MCP |
| Gemini CLI | `BeforeAgent` hook (`hookSpecificOutput.additionalContext`; trusted workspace) | none native | MCP |
| Pi | `before_agent_start` / `context` hooks | native: `pi.sendMessage(…, {triggerTurn:true})`, `deliverAs` steer/followUp/nextTurn | `pi.registerTool` |
Generic push fallback (option only, fragile): launcher runs the agent in its own PTY and types a short pointer.

## Data
**In the note** (source of truth, readable without the plugin):
- Marks: `{id="s7" author="Claude" date="2026-10-24"~~old~>new~~}{id="c3" author="Claude">>why<<}`;
  kinds add/del/sub/comment/highlight; attrs `id`, `author`, `date`, `edited-by`. Comment threads = adjacent comments
  (root anchors to preceding mark), per obsidian-track-changes. Authors: user name from settings, `Claude`/`Codex`, `external`.

**In `<vault>/.coedit/`:**
- `endpoint.json` — hub port + token (written by the Obsidian plugin).
- `config.json` — attached notes, settings (digest budget, author name).
- `log/<note-path>.jsonl` — **one event log per note** = ledger + outbox + trail: suggestions (with original text),
  decisions (accept / accept-with-edit with suggested vs final / reject / reject+note), own-edit summaries,
  external diffs, intents, deliveries. Pinned envelope `{v, seq, type, ts, note, session, agent, ...}` (as super-coach trail).
- `cursor.json` — per-agent read cursor (`seq`). Outbox = log entries after cursor.
- `snapshots/` — last known content per attached note (for external-change detection).
- `style.md` — agent-maintained voice/style notes (from decisions; read on each intent).

## Session ↔ vault connection
- Obsidian plugin = long-lived **hub**: WebSocket on 127.0.0.1:<random>, token in `endpoint.json`.
- `coedit claude [--doc note.md]` (run inside the vault, or via Obsidian command "Start co-editor" which opens
  Terminal/iTerm) launches `claude --agent co-editor --mcp-config … --settings <hooks> --dangerously-load-development-channels server:coedit`.
- The MCP server finds the vault root (walk up to `.obsidian/`), reads `endpoint.json`, connects, registers
  `{agent, pid, session}`. Status bar: `● Claude · 3 notes`. Reconnects on restart; no state lost (all in note + log).
- Obsidian closed → **file mode**: safe writes (hold file, quiet-wait, lock, re-read, atomic replace, verify — from the
  agent plugin) and log-only decisions.

## Event model & delivery
- **Intents** (only these wake the agent, always explicit): Ask (selection bubble + prompt field), Send reply,
  finish-pass verbs (Done → next pass / Rework rejections / Apply my choices throughout / Review my edits) with a
  free-text instruction field, Refresh (full re-read).
- **Context** (never wakes, rides along via the digest): decisions, own-edit summaries, external changes, new files.
- **Digest compiler** (shared by all paths), budget ~2k tokens: per item id, type, heading path, before/after ≤200 chars;
  large/new content → stats + outline only; agent expands via `get_detail(id)`.
- **Delivery paths**, all advancing the same cursor (no duplicates), panel shows "seen by Claude 14:02":
  1. Push (on your click) — Claude: channel notification (`notifications/claude/channel`, small payload + seq).
     Codex: `codex queue --remote <sock> --thread <id> --message "<pointer>"`; the launcher starts
     `codex app-server --listen unix://<vault>/.coedit/codex.sock` and the TUI with `codex --remote unix://…` so the
     visible session shares that server. Pushed text is only a short pointer ("intent #12 … see get_inbox"), treated as untrusted.
  2. Pull (you type in the terminal) — `UserPromptSubmit` hook (coedit session only; Claude and Codex both support it)
     runs `coedit inbox --digest --mark-read` → additionalContext (≤10k chars).
  3. Nudge — status bar "request waiting → terminal" if push is unavailable.
  No blocking wait tool in v1 (it would block the terminal and cost tokens per re-arm); revisit only for generic MCP agents.
- Throttle: one intent in flight (buttons disabled + "working…"), double-click dedupe, small budget guard as safety net.
  Agent signals completion via `finish(intent_id, summary)`; Claude `Stop` hook as fallback to clear "working".

## MCP tools (server)
`get_context` (attached notes, selection, outbox stats) · `get_document(path)` · `get_inbox(mark_read)` ·
`get_detail(id)` · `suggest_edit(path, find, replace, rationale, contextBefore?, contextAfter?)` ·
`comment(path, anchor, text)` · `reply(thread_id, text)` · `finish(intent_id, summary)`.
Write path: hub connected → ops sent to Obsidian, applied as one CM6 transaction after rebase; otherwise file mode.
Claude guard: PreToolUse hook blocks `Edit`/`Write` on attached notes (cowrite idea).

## Obsidian UI
- CM6 decorations in a StateField (per obsidian-track-changes), author colours, hidden syntax when unfocused, `atomicRanges`.
- **Live Track Changes** (Word "Track Changes: On") via `transactionFilter`, enabled by the per-vault UI toggle:
  typing → extends own `{++}`; delete original → `{--}`; overwrite → `{~~}`; delete inside own insertion → real delete;
  typing inside agent suggestion → modifies it + `edited-by`; multi-block paste → one mark per block, markers outside.
  Fallback if spike fails: shadow diff vs snapshot.
- Display modes (status bar): All Markup / Simple Markup (gutter change bars) / No Markup / Original.
- **Comments & threads are panel things**: persisted inline in the note (CriticMarkup `{==span==}{>>…<<}`, replies as
  adjacent comments — threads + attr prefix are the obsidian-track-changes convention, not spec), but in the editor only a
  marker (💬 + message count, author colour) plus a subtle permanent highlight of the commented span (stronger when the
  thread is focused). Clicking the highlighted text or the marker: (a) reveals the panel if hidden/collapsed
  (`workspace.revealLeaf`), (b) scrolls to, focuses and flashes the thread card — editor keeps focus and cursor placement.
  Cursor entering a span via keyboard syncs an open panel but does not reveal a hidden one (setting). Panel → editor:
  clicking a thread scrolls to and highlights its span. Overlaps: innermost focused. Span-less comments: click the marker.
  Reply, resolve and delete happen in the panel.
- CriticMarkup syntax stays hidden even when the cursor is inside a mark (otherwise tracked typing would constantly reveal
  `{author=… ++`); ordinary Markdown keeps Obsidian's reveal-on-focus. Raw marks via Source mode / Original.
- Untracked zones (marks would break rendering): frontmatter, code blocks, tables.
- Structural edits (heading level, list↔paragraph, bold toggle): block markers stay outside marks; record as whole-line
  change or leave untracked + logged — decided in spike S1.
- Without a session everything works except Ask/footer (disabled: "no co-editor connected").
- Floating change toolbar on cursor/hover: ✓ accept · ✗ reject · ✗✎ reject with note · ✎ edit-then-accept · 💬 reply.
- Selection bubble: ✨ Ask (inline prompt field) · 💬 Comment.
- **Review panel** (Word Review tab): toolbar Prev/Next/Accept/Reject/Accept all/Reject all, filter by author/kind,
  cards with threads, external-change banner + Refresh, footer outbox (counts, instruction field, verb split button,
  "seen by" state, working indicator).
- Commands + hotkeys for all actions; "Start co-editor"; attach/detach note.

## Reuse (copy/adapt, not depend)
- `obsidian-track-changes/src/parser.ts` — attr-prefix grammar, `findCodeRegions`, thread adjacency.
- `obsidian-track-changes/src/operations.ts` — `SourceEdit` + `rebaseEdits` (±200 char anchor revalidation).
- `obsidian-track-changes/src/main.ts:543` — `applyEditsToFile` (CM6 dispatch w/ isolateHistory → Vault.process).
- `obsidian-track-changes/src/editor/decorations.ts`, `src/panel/view.ts` (PanelHost adapter, cards).
- `claude-plugin-obsidian-track-changes-agent/bin/obsidian-track-changes-agent` — `write()` safety :481-517,
  `find_unique` :402, hold file :146-167, seen-state cursor :945-971; "unaccepted = undecided" principle.
- super-coach `src/coach/trail.ts` (envelope), `resources/coach/inject-context.mjs` (hook digest + hash dedupe),
  `src/coach/coachServer.ts` (suggest_edit shape), `resources/coach/super-coach.md` (agent prompt);
  `claude-mod-poc/` (cowrite: decision digest, Edit guard).

## Phases
0. **Spikes (go/no-go, throwaway)**
   - S1 Live tracking in Obsidian Live Preview: boundary typing/merging, atomicRanges, undo/redo, multi-block paste, structural edits,
     IME, Vim mode, auto-pair conflicts. Fail → shadow diff.
   - S2 Custom channel: stdio MCP server with `claude/channel` + WS client, loaded via dev flag in interactive `claude`;
     button click → event in session; queued-while-busy behaviour.
   - S3 Codex (install CLI ≥0.149): TUI via `--remote` against own app-server; does `codex queue` to that thread show up
     and run in the visible TUI (idle + busy)? `UserPromptSubmit` additionalContext for the digest. Fail → pull + nudge only.
1. `packages/format` with full unit tests (parse, ops, rebase, tracking transforms as pure functions).
2. Obsidian plugin standalone (no agent): rendering, live tracking, display modes, floating toolbar, review panel.
3. Server + launcher + Claude adapter: tools, hub connection, file mode, event log, digest, cursor, push + pull, guard.
4. Intent UI: selection Ask, verbs + instruction field, working/seen states, Refresh, external-change → `external` marks.
5. Codex adapter (per S3 result).

## Verification
- `packages/format`: vitest unit tests incl. tracking transform cases and round-trip parse/serialize.
- Tracking: headless CM6 `EditorView` (jsdom) tests replaying user transactions (type, backspace, paste, undo).
- Server: tests against a mock hub; digest size asserted ≤ budget; cursor dedupe across push/pull/get_inbox.
- Manual e2e in a test vault (plugin symlinked into `.obsidian/plugins/`), `coedit claude`:
  1. Ask on selection → suggestions appear inline + panel; "working…" clears.
  2. Edit-then-accept, reject with note, accept → Done → next pass with instruction → agent references decisions.
  3. Terminal-only turn → hook digest consumed → panel shows "seen".
  4. Edit note in an IDE → banner + `external` marks; Refresh → full re-read.
  5. Quit Obsidian → agent suggestion via file mode; reopen → marks render.
  6. Tracking on a note with no session running.
  7. Unrelated `claude` session → no coedit tools/hooks loaded.
