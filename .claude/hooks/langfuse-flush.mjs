#!/usr/bin/env node
// Langfuse trace forwarder — flush-on-stop variant.
//
// Why this exists alongside langfuse-trace.mjs:
//   langfuse-trace.mjs flushes on every Claude Code hook (PreToolUse,
//   PostToolUse, …) and uses cursors + dead-letters + a replayer to
//   patch over the failures that high-frequency flushing causes
//   (Langfuse 207s, async-worker drops, parallel-cursor races). This
//   file is a simpler alternative: subscribe to Stop and SubagentStop
//   only, walk the relevant transcripts, post in chunks. One POST
//   group per scope (orchestrator or one subagent), per turn — at
//   least 10x fewer requests, no race conditions, no dead-letter
//   layer.
//
// What it does:
//   • SubagentStop → flush just the finishing subagent's transcript.
//     Subagent traces appear in Langfuse as soon as the subagent
//     finishes, before the orchestrator turn ends. That's the "live
//     feel" — you don't wait until session end to see anything.
//   • Stop (orchestrator only) → flush the orchestrator transcript +
//     sweep every subagent transcript under <sid>/subagents/. The
//     sweep is the safety net for any SubagentStop POST that failed
//     and for orphan subagents whose SubagentStop never fired.
//   • SessionEnd → same code path as Stop. Catches the "user closed
//     the terminal mid-turn" case where Stop wouldn't have fired.
//
// What it does NOT do (deliberate trade-offs):
//   • No per-tool spans. The old per-event hook created Pre/PostToolUse
//     spans so you could see Task attempts even when they produced
//     zero generations. Bringing those back means flushing on every
//     tool use, which is what overloads Langfuse. If you need this,
//     run langfuse-trace.mjs instead — it's the higher-frequency
//     variant.
//   • No live updates during a long autonomous orchestrator run.
//     Stop fires per assistant response, not per tool use. If Claude
//     chews through 40 tool calls in one response, the orchestrator
//     transcript grows for minutes without a flush. Subagents started
//     during that run still appear live (SubagentStop fires per
//     subagent), but the orchestrator's own generations wait until
//     it returns to the user.
//   • No automatic recovery for an orchestrator that crashes before
//     Stop fires. The transcript on disk has the data, but nothing in
//     this script knows to look at it. Use --catchup (below) to
//     reconcile after a crash.
//
// Correctness model:
//   • Per-transcript cursor (`.claude/.langfuse-flush/<key>.json`)
//     records the last forwarded line. Advances only on a successful
//     flush. If a flush fails, the next Stop tick re-tries the same
//     range. No dead-letter file needed — the transcript on disk is
//     itself the durable queue.
//   • Generation observation IDs are a deterministic hash of
//     (rootSessionId, agentId, message.id). Langfuse upserts on id,
//     so re-sending the same lines is idempotent and never inflates
//     cost. message.id (not the JSONL uuid) collapses Anthropic's
//     stream-resume rows to a single observation.
//   • Subagent traces use the orchestrator's sessionId so they fold
//     into one Session in Langfuse and the total cost matches
//     `/cost`.
//
// Plug-and-play:
//   No dependencies, vanilla Node 20+. Drop this file in any project's
//   .claude/hooks/, add LANGFUSE_* to .env, and wire it in
//   .claude/settings.json:
//
//     {
//       "hooks": {
//         "Stop":         [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/langfuse-flush.mjs" }] }],
//         "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/langfuse-flush.mjs" }] }],
//         "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/langfuse-flush.mjs" }] }]
//       }
//     }
//
// Manual recovery:
//   --verify <session-id>
//       Re-emit orchestrator + every subagent for one session,
//       ignoring cursors. Run if a session shows gaps in Langfuse.
//       Idempotent (deterministic IDs → Langfuse upserts).
//   --flush-transcript <abs-jsonl-path>
//       Re-emit one transcript from line 0.
//   --catchup [--max-age-hours N]
//       Scan ~/.claude/projects/<projectSlug>/ for any transcript
//       whose cursor is behind the file end, and flush each one.
//       Default window: 72h. Run after an orchestrator crash, or
//       wire to a SessionStart hook.
//   --catchup-worktrees [--max-age-hours N]
//       Same scan, but over the sibling slugs of sessions started
//       inside a worktree under this project (e.g. a `claude` run in
//       <projectDir>/.claude/worktrees/<name>). Those get their own
//       cwd-derived slug that plain --catchup never descends into.
//   --catchup-all [--max-age-hours N]
//       Main slug + every worktree slug, in one pass.
//   --force (combine with any --catchup* flag)
//       Ignore cursors: fullRetail-flush every candidate in the age
//       window, not just the ones behind the file end. Needed after
//       adding/fixing a Langfuse model definition, since Langfuse prices
//       a generation at ingestion time — a model added to the catalog
//       later does nothing for observations already stored. Deterministic
//       IDs make this an upsert, so it's safe to run repeatedly.
//
// Known Langfuse gotcha (observed against self-hosted v3, 2026-05):
//   The /api/public/ingestion endpoint returns 200 OK *before* the
//   async worker persists trace-create events. If a generation-create
//   in the same batch reaches the worker before its sibling trace is
//   committed, the observation is dropped silently — the trace shows
//   up in the UI with no observations under it. This script defends
//   against that in two ways:
//     1. Two-phase POST: trace-create alone, then a PHASE_DELAY_MS
//        pause, then everything else. The pause gives the worker time
//        to commit before observations arrive.
//     2. fullRetail on Stop / SessionEnd: at the end of every turn,
//        re-emit every subagent's events ignoring the cursor.
//        Deterministic observation IDs → Langfuse upserts, so the
//        cost is bandwidth, not duplicate counting.
//   If a session still shows gaps despite both defenses, run
//   `--verify <sid>` once or twice; the trace is now committed and
//   the observations land.

import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── project root + env ────────────────────────────────────────────────
function findProjectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const projectDir = findProjectRoot();

// Resolve the .env to read. In a git worktree, `.env` is gitignored and so is
// absent, but it lives in the main checkout. `--git-common-dir` points at the
// main `.git` from any worktree; its parent is the main checkout root. This
// makes the hook self-heal in any worktree (harness-created or `exp:new`)
// without copying or symlinking the secret file. Falls back to projectDir/.env
// (the main-checkout case, and the not-a-git-dir case).
function dotenvPath() {
  const local = join(projectDir, ".env");
  if (existsSync(local)) return local;
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const mainEnv = join(dirname(commonDir), ".env");
    if (existsSync(mainEnv)) return mainEnv;
  } catch {
    // not a git dir, or git unavailable — fall through to the local path
  }
  return local;
}

function loadDotenv() {
  const path = dotenvPath();
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}
const env = { ...loadDotenv(), ...process.env };

if (env.LANGFUSE_ENABLED !== "true") process.exit(0);
const HOST = env.LANGFUSE_HOST || "http://localhost:3001";
const PUBLIC_KEY = env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = env.LANGFUSE_SECRET_KEY;
// Enabled but misconfigured is a real error, unlike "disabled" above —
// surface it instead of silently no-op'ing, since a hook that never
// prints anything is invisible when someone forgets to set the keys.
if (!PUBLIC_KEY || !SECRET_KEY) {
  const missing = [
    !PUBLIC_KEY && "LANGFUSE_PUBLIC_KEY",
    !SECRET_KEY && "LANGFUSE_SECRET_KEY",
  ].filter(Boolean).join(", ");
  process.stderr.write(`[langfuse-flush] LANGFUSE_ENABLED=true but missing ${missing} — skipping flush\n`);
  process.exit(0);
}
const TIMEOUT_MS = Number(env.LANGFUSE_TIMEOUT_MS || 10000);
// Conservative chunk size keeps each POST under ~200KB and well under any
// reasonable hook timeout. Langfuse's worker handles a few sequential
// chunks much better than dozens of concurrent flush hooks.
const CHUNK_SIZE = Number(env.LANGFUSE_CHUNK_SIZE || 100);
// Delay between Phase 1 (trace-create) and Phase 2 (observations).
// Langfuse returns 200 OK on /ingestion before its async worker has
// persisted the trace; if Phase 2 arrives at a worker that still
// can't see the trace, the observation is dropped silently. 500ms
// empirically lands every observation on a self-hosted instance;
// drop to 200ms if you trust your Langfuse to be faster.
const PHASE_DELAY_MS = Number(env.LANGFUSE_PHASE_DELAY_MS || 500);

// ─── small helpers ─────────────────────────────────────────────────────
function hash(s) {
  return createHash("sha256").update(String(s)).digest("hex").slice(0, 32);
}
function truncate(v, max = 8000) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > max ? s.slice(0, max) + "…[truncated]" : s;
}
function parseSubagentPath(tp) {
  const m = tp.match(/\/([0-9a-f-]{36})\/subagents\/agent-([0-9a-f]+)\.jsonl$/);
  return m ? { rootSessionId: m[1], agentId: m[2] } : null;
}
function extractAssistantOutput(content) {
  if (!Array.isArray(content)) return truncate(content);
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "thinking" && b.thinking) parts.push(`[thinking] ${b.thinking}`);
    else if (b.type === "tool_use") parts.push(`[tool_use ${b.name}] ${JSON.stringify(b.input ?? {})}`);
  }
  return truncate(parts.join("\n\n"));
}
function extractUserInput(content) {
  if (typeof content === "string") return truncate(content);
  if (!Array.isArray(content)) return truncate(content);
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "tool_result") {
      const c = b.content;
      parts.push(`[tool_result] ${typeof c === "string" ? c : JSON.stringify(c)}`);
    }
  }
  return truncate(parts.join("\n\n"));
}

// ─── cursors ───────────────────────────────────────────────────────────
// One file per transcript. Subagent keys are `<rootSid>-<agentId>` so
// the orchestrator's advance can never trample a subagent cursor.
// Lives in its own directory so this script doesn't share state with
// langfuse-trace.mjs while both are wired up.
const cursorDir = join(projectDir, ".claude", ".langfuse-flush");
function cursorPath(key) { return join(cursorDir, `${key}.json`); }
function readCursor(key) {
  try { return JSON.parse(readFileSync(cursorPath(key), "utf8")); }
  catch { return { lastLineIndex: -1 }; }
}
function writeCursor(key, c) {
  try {
    if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
    const p = cursorPath(key);
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(c));
    renameSync(tmp, p);
  } catch { /* best-effort */ }
}

// ─── transcript → batch ────────────────────────────────────────────────
// Builds the Langfuse batch for everything past `fromIndex` in
// `transcriptPath`. Returns the events and the new index to write back
// on a successful POST. Same deterministic IDs as langfuse-trace.mjs,
// so the two scripts are id-compatible — running both side by side is
// harmless (Langfuse upserts).
function buildScope({ transcriptPath, scope, fromIndex }) {
  const events = [];
  if (!existsSync(transcriptPath)) {
    return { events, newIndex: fromIndex };
  }
  let lines;
  try { lines = readFileSync(transcriptPath, "utf8").split("\n"); }
  catch { return { events, newIndex: fromIndex }; }

  // Find the FIRST user message in the transcript — that's the
  // session's defining prompt (orchestrator) or the subagent's task
  // brief. We replaced the old UserPromptSubmit hook with transcript
  // extraction so the trace.input field still gets populated.
  let firstUserInput = null;
  // Anchor the trace timestamp to the session's first message, not
  // wall-clock now. On a live flush the two are ~the same, but on a
  // --verify / --catchup replay `new Date()` would stamp the trace at
  // replay time — hours after its observations — and Langfuse's Session
  // view (which threads turns by trace timestamp) then collapses to a
  // single entry. Anchoring keeps the trace contemporaneous with its
  // turns and is deterministic across re-flushes.
  let firstEventTs = null;
  // Prime lastUserInput from history before fromIndex so the first
  // generation in this chunk still has the right `input` field.
  let lastUserInput = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    try {
      const d = JSON.parse(lines[i]);
      if (firstEventTs === null && d.timestamp) firstEventTs = d.timestamp;
      if (d.type === "user" && d.message) {
        const text = extractUserInput(d.message.content);
        if (firstUserInput === null) firstUserInput = text;
        if (i <= fromIndex) lastUserInput = text;
      }
    } catch { /* skip */ }
  }
  const traceTs = firstEventTs || new Date().toISOString();

  // Trace upsert (cheap; Langfuse merges with prior trace-creates).
  events.push({
    id: randomUUID(),
    type: "trace-create",
    timestamp: traceTs,
    body: {
      id: scope.traceId,
      name: scope.traceName,
      sessionId: scope.rootSessionId,
      input: firstUserInput,
      metadata: {
        transcript: transcriptPath,
        root_session_id: scope.rootSessionId,
        is_subagent: scope.kind === "subagent",
        agent_id: scope.agentId,
        agent_type: scope.agentType,
      },
      tags: scope.kind === "subagent"
        ? ["claude-code", "subagent", scope.agentType].filter(Boolean)
        : ["claude-code"],
    },
  });

  // Collapse rows by observation id, then emit one event per message.
  // Anthropic stream-resume splits one logical assistant message across
  // several JSONL rows that share m.id but interleave with tool_result
  // rows. Emitting one generation-create per row and leaning on Langfuse's
  // last-write-wins upsert corrupts the collapsed observation: a row that
  // lands after a tool_result carries that tool_result as `input` and a
  // trailing tool_use as `output`, clobbering the real prompt and the
  // assistant's prose. So consolidate per id — freeze `input` at the
  // message's FIRST row and accumulate `output` across all its rows.
  // (Per-row usage repeats the full-message usage, so refreshing it to the
  // latest row keeps /cost parity without double-counting.)
  function usageDetails(usage) {
    return {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      total:
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
    };
  }
  const genById = new Map(); // obsId → consolidated body, insertion-ordered
  let newIndex = fromIndex;
  for (let i = fromIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    newIndex = i;
    if (!line || !line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type === "user" && d.message) {
      lastUserInput = extractUserInput(d.message.content);
      continue;
    }
    if (d.type !== "assistant" || !d.message) continue;
    const m = d.message;
    const usage = m.usage || {};
    const ts = d.timestamp || new Date().toISOString();
    const outputText = extractAssistantOutput(m.content);
    // Hash on message.id so Anthropic stream-resume rows (which share m.id
    // but each get a fresh JSONL uuid) collapse to one observation. uuid
    // fallback only for malformed rows.
    const obsId = hash(`gen:${scope.rootSessionId}:${scope.agentId || "orch"}:${m.id || d.uuid || `${i}:${ts}`}`);
    const prev = genById.get(obsId);
    if (!prev) {
      genById.set(obsId, {
        id: obsId,
        traceId: scope.traceId,
        name: `gen:${scope.agentType || (scope.kind === "subagent" ? "subagent" : "orchestrator")}`,
        startTime: ts,
        endTime: ts,
        model: m.model,
        modelParameters: m.stop_reason ? { stop_reason: m.stop_reason } : undefined,
        input: lastUserInput, // frozen at the message's first row
        output: outputText || "",
        usageDetails: usageDetails(usage),
        metadata: {
          message_uuid: d.uuid,
          stop_reason: m.stop_reason,
          request_id: d.requestId,
          root_session_id: scope.rootSessionId,
          is_subagent: scope.kind === "subagent",
          agent_id: scope.agentId,
          agent_type: scope.agentType,
        },
      });
    } else {
      // Later row of the same message: extend output, advance endTime,
      // refresh usage/stop_reason to the latest row. `input` stays frozen.
      if (outputText) prev.output = prev.output ? `${prev.output}\n\n${outputText}` : outputText;
      prev.endTime = ts;
      prev.usageDetails = usageDetails(usage);
      if (m.stop_reason) {
        prev.modelParameters = { stop_reason: m.stop_reason };
        prev.metadata.stop_reason = m.stop_reason;
      }
    }
  }

  // Emit one generation-create per collapsed message, in transcript order.
  let lastAssistantText = null;
  for (const body of genById.values()) {
    body.output = truncate(body.output);
    if (body.output && body.output.length > 0) lastAssistantText = body.output;
    events.push({
      id: randomUUID(),
      type: "generation-create",
      timestamp: body.startTime,
      body,
    });
  }

  // Patch the trace output so the Langfuse list view shows the latest
  // assistant turn at a glance. Re-send `input` here too — trace-create
  // is upsert in Langfuse and omitting a field in a later event can null
  // out the value set by the earlier event.
  if (lastAssistantText) {
    events.push({
      id: randomUUID(),
      type: "trace-create",
      timestamp: traceTs,
      body: {
        id: scope.traceId,
        sessionId: scope.rootSessionId,
        input: firstUserInput,
        output: lastAssistantText,
      },
    });
  }

  return { events, newIndex };
}

// ─── chunked POST ──────────────────────────────────────────────────────
// One scope's batch is split into CHUNK_SIZE-event chunks and POSTed
// sequentially. Returns true only when every chunk landed cleanly.
// Failures are logged to stderr (Claude Code surfaces it) but never
// throw — telemetry must not block the agent.
async function postChunks(batch) {
  if (!batch.length) return true;
  const auth = "Basic " + Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString("base64");
  for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
    const chunk = batch.slice(i, i + CHUNK_SIZE);
    let res;
    try {
      res = await fetch(`${HOST}/api/public/ingestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ batch: chunk }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      process.stderr.write(`[langfuse-flush] POST error chunk ${i}: ${e.message}\n`);
      return false;
    }
    if (res.ok && res.status !== 207) continue;
    if (res.status === 207) {
      let body = null;
      try { body = await res.json(); } catch { /* ignore */ }
      const errs = Array.isArray(body?.errors) ? body.errors : null;
      if (errs && errs.length === 0) continue;
      process.stderr.write(`[langfuse-flush] 207 with ${errs?.length ?? "?"} errors on chunk ${i}\n`);
      return false;
    }
    process.stderr.write(`[langfuse-flush] POST ${res.status} on chunk ${i}\n`);
    return false;
  }
  return true;
}

// ─── flush one scope ───────────────────────────────────────────────────
// Two-phase POST:
//   Phase 1 — trace-create alone. Wait for OK.
//   Phase 2 — generations + trace-update (output). Wait for OK.
// Without this split, Langfuse's async worker processes batch events
// in parallel; a generation-create handled before its sibling
// trace-create has persisted is silently dropped (the observation has
// no parent yet). Splitting guarantees the trace materializes before
// any observation references it. Observed locally: ~50% of single-
// batch SubagentStop POSTs lost their generation; with the split, all
// land. Cost: one extra HTTP round-trip per scope per flush.
//
// fullRetail: ignore the cursor when reading the transcript and re-
// emit every assistant turn. Cursor is still advanced to newIndex on
// success. Used by Stop / SessionEnd / --verify as a backstop for any
// event that vanished into Langfuse despite a 200 OK.
async function flushScope({ transcriptPath, scope, key, fullRetail = false }) {
  const cursor = readCursor(key);
  const fromIndex = fullRetail ? -1 : cursor.lastLineIndex;
  const { events, newIndex } = buildScope({
    transcriptPath, scope, fromIndex,
  });
  // Nothing on disk past the cursor and we're not force-retailing.
  if (!fullRetail && newIndex === cursor.lastLineIndex) return true;
  if (events.length === 0) return true;

  // Phase 1: trace-create alone.
  const traceOnly = [events[0]];
  let ok = await postChunks(traceOnly);
  if (!ok) return false;

  // Phase 2: everything else (generations + final trace-update).
  const rest = events.slice(1);
  if (rest.length) {
    // Give Langfuse's async worker time to actually commit the trace
    // before the observations referencing it arrive.
    if (PHASE_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PHASE_DELAY_MS));
    }
    ok = await postChunks(rest);
    if (!ok) return false;
  }

  cursor.lastLineIndex = newIndex;
  writeCursor(key, cursor);
  return true;
}

// ─── scope builders ────────────────────────────────────────────────────
function subagentScope(rootSessionId, agentId, agentType) {
  return {
    kind: "subagent",
    traceId: `claude-${rootSessionId}-${agentId}`,
    rootSessionId,
    agentId,
    agentType,
    traceName: `claude-code:subagent ${agentType || ""} ${agentId.slice(0, 8)}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}
function orchestratorScope(rootSessionId) {
  return {
    kind: "orchestrator",
    traceId: `claude-${rootSessionId}`,
    rootSessionId,
    agentId: null,
    agentType: null,
    traceName: `claude-code:${rootSessionId.slice(0, 8)}`,
  };
}
function readMetaAgentType(subDir, agentId) {
  try {
    const meta = JSON.parse(readFileSync(join(subDir, `agent-${agentId}.meta.json`), "utf8"));
    return meta.agentType || meta.agent_type || null;
  } catch { return null; }
}

// ─── manual recovery: --catchup ────────────────────────────────────────
// Scans ~/.claude/projects/<slug>/ for transcripts whose cursor is
// behind the file end and flushes each. Skips transcripts modified in
// the last 60s (probably still being written by an active session).
// Skips transcripts older than --max-age-hours (default 72) to avoid
// re-uploading ancient history when first installed.
// Pick which project-slug dirs a --catchup* run sweeps. Claude Code names
// each transcript dir after the session's cwd, with `/` (and `.`) collapsed
// to `-`. A session started inside a worktree under this project — e.g. a
// `claude` run in <projectDir>/.claude/worktrees/<name> — therefore gets its
// own slug that begins with the main slug followed by a separator, which the
// "main" scan never descends into. Mode selects the set:
//   "main"      → just this checkout's slug (legacy --catchup); falls back to
//                 every project dir if this slug isn't on disk yet.
//   "worktrees" → only sibling slugs nested under this project's path.
//   "all"       → main + worktrees.
function catchupSlugs(projectsRoot, mode) {
  const expectedSlug = projectDir.replace(/\//g, "-");
  const mainExists = existsSync(join(projectsRoot, expectedSlug));
  let all = [];
  try { all = readdirSync(projectsRoot); } catch { /* none */ }
  const worktreeSlugs = all.filter(
    (s) => s !== expectedSlug && s.startsWith(`${expectedSlug}-`),
  );
  if (mode === "worktrees") return worktreeSlugs;
  if (mode === "all") return mainExists ? [expectedSlug, ...worktreeSlugs] : all;
  return mainExists ? [expectedSlug] : all;
}

async function runCatchup({ maxAgeHours, mode = "main", force = false }) {
  // Claude Code stores transcripts at:
  //   ~/.claude/projects/<projectDir-with-slashes-as-dashes>/<sid>.jsonl
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) {
    process.stderr.write("[langfuse-flush] no ~/.claude/projects dir — nothing to catch up\n");
    return 0;
  }
  const candidates = catchupSlugs(projectsRoot, mode);
  // Fail loud: name every slug a non-default mode sweeps, so an
  // over-inclusive prefix match (a sibling project sharing a name prefix)
  // is visible rather than silent.
  if (mode !== "main") {
    process.stderr.write(`[langfuse-flush] catchup mode=${mode}: ${candidates.length} slug(s)\n`);
    for (const s of candidates) process.stderr.write(`[langfuse-flush]   ${s}\n`);
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 3600 * 1000;
  const minQuietMs = 60 * 1000;
  const targets = [];

  for (const slug of candidates) {
    const dir = join(projectsRoot, slug);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const tp = join(dir, f);
      let st;
      try { st = statSync(tp); } catch { continue; }
      const age = now - st.mtimeMs;
      if (age > maxAgeMs) continue;     // too old
      if (age < minQuietMs) continue;   // still being written
      const sid = f.replace(/\.jsonl$/, "");
      targets.push({ tp, scope: orchestratorScope(sid), key: sid });

      // Subagent transcripts for this session.
      const subDir = join(dir, sid, "subagents");
      if (!existsSync(subDir)) continue;
      let subEntries;
      try { subEntries = readdirSync(subDir); } catch { continue; }
      for (const sf of subEntries) {
        const m = sf.match(/^agent-([0-9a-f]+)\.jsonl$/);
        if (!m) continue;
        const subTp = join(subDir, sf);
        let subSt;
        try { subSt = statSync(subTp); } catch { continue; }
        const subAge = now - subSt.mtimeMs;
        if (subAge > maxAgeMs) continue;
        if (subAge < minQuietMs) continue;
        const aid = m[1];
        const agentType = readMetaAgentType(subDir, aid);
        targets.push({
          tp: subTp,
          scope: subagentScope(sid, aid, agentType),
          key: `${sid}-${aid}`,
        });
      }
    }
  }

  let flushed = 0;
  let upToDate = 0;
  let failed = 0;
  for (const t of targets) {
    const cursor = readCursor(t.key);
    let lineCount = 0;
    try { lineCount = readFileSync(t.tp, "utf8").split("\n").length; } catch { continue; }
    // --force skips the cursor check entirely: every candidate in the age
    // window gets fullRetail-flushed, regardless of what's already been
    // sent. This is the only way to make Langfuse re-price generations
    // after a model definition was added or corrected post-hoc — Langfuse
    // computes cost at ingestion time, not retroactively, so a model
    // added to its catalog does nothing for observations already stored.
    // Deterministic observation IDs make this an upsert, so re-running it
    // is always safe.
    if (!force && cursor.lastLineIndex >= lineCount - 1) {
      upToDate++;
      continue;
    }
    process.stderr.write(`[langfuse-flush] catchup${force ? " (forced)" : ""}: ${t.tp} (cursor ${cursor.lastLineIndex}, end ${lineCount - 1})\n`);
    const ok = await flushScope({ transcriptPath: t.tp, scope: t.scope, key: t.key, fullRetail: force });
    if (ok) flushed++; else failed++;
  }
  process.stderr.write(`[langfuse-flush] catchup done: ${flushed} flushed, ${upToDate} up-to-date, ${failed} failed (of ${targets.length} candidates)\n`);
  return failed > 0 ? 2 : 0;
}

const catchupModes = {
  "--catchup": "main",
  "--catchup-worktrees": "worktrees",
  "--catchup-all": "all",
};
const catchupFlag = process.argv.find((a) => a in catchupModes);
if (catchupFlag) {
  const maxAgeFlag = process.argv.indexOf("--max-age-hours");
  const maxAgeHours = maxAgeFlag !== -1
    ? Number(process.argv[maxAgeFlag + 1])
    : 72;
  const force = process.argv.includes("--force");
  process.exit(await runCatchup({ maxAgeHours, mode: catchupModes[catchupFlag], force }));
}

// ─── manual recovery: --flush-transcript <path> ────────────────────────
const flushIdx = process.argv.indexOf("--flush-transcript");
if (flushIdx !== -1) {
  const tp = process.argv[flushIdx + 1];
  if (!tp || !existsSync(tp)) {
    process.stderr.write("[langfuse-flush] --flush-transcript requires an existing path\n");
    process.exit(1);
  }
  const sub = parseSubagentPath(tp);
  let scope, key;
  if (sub) {
    const agentType = readMetaAgentType(dirname(tp), sub.agentId);
    scope = subagentScope(sub.rootSessionId, sub.agentId, agentType);
    key = `${sub.rootSessionId}-${sub.agentId}`;
  } else {
    const sid = tp.split("/").pop().replace(/\.jsonl$/, "");
    scope = orchestratorScope(sid);
    key = sid;
  }
  // Reset cursor → re-flush every line. Deterministic IDs → Langfuse
  // upserts, no double-counting.
  const ok = await flushScope({ transcriptPath: tp, scope, key, fullRetail: true });
  process.exit(ok ? 0 : 2);
}

// ─── manual recovery: --verify <sid> ───────────────────────────────────
// Re-emits orchestrator + every subagent for one session, ignoring
// cursors. Use after a session shows gaps in Langfuse — Langfuse
// upserts so it's safe to run any number of times.
const verifyIdx = process.argv.indexOf("--verify");
if (verifyIdx !== -1) {
  const sid = process.argv[verifyIdx + 1];
  if (!sid) {
    process.stderr.write("[langfuse-flush] --verify requires a session id\n");
    process.exit(1);
  }
  const projectsRoot = join(homedir(), ".claude", "projects");
  const expectedSlug = projectDir.replace(/\//g, "-");
  const slugRoot = existsSync(join(projectsRoot, expectedSlug))
    ? join(projectsRoot, expectedSlug)
    : null;
  if (!slugRoot) {
    process.stderr.write(`[langfuse-flush] could not find ~/.claude/projects/${expectedSlug}\n`);
    process.exit(1);
  }
  const orchPath = join(slugRoot, `${sid}.jsonl`);
  if (!existsSync(orchPath)) {
    process.stderr.write(`[langfuse-flush] no transcript at ${orchPath}\n`);
    process.exit(1);
  }
  process.stderr.write(`[langfuse-flush] verify: orchestrator ${sid}\n`);
  let allOk = await flushScope({
    transcriptPath: orchPath,
    scope: orchestratorScope(sid),
    key: sid,
    fullRetail: true,
  });
  const subDir = join(slugRoot, sid, "subagents");
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir)) {
      const m = f.match(/^agent-([0-9a-f]+)\.jsonl$/);
      if (!m) continue;
      const aid = m[1];
      const agentType = readMetaAgentType(subDir, aid);
      process.stderr.write(`[langfuse-flush] verify: subagent ${aid} (${agentType || "?"})\n`);
      const ok = await flushScope({
        transcriptPath: join(subDir, f),
        scope: subagentScope(sid, aid, agentType),
        key: `${sid}-${aid}`,
        fullRetail: true,
      });
      if (!ok) allOk = false;
    }
  }
  process.stderr.write(`[langfuse-flush] verify done: ${allOk ? "ok" : "had failures"}\n`);
  process.exit(allOk ? 0 : 2);
}

// ─── hook mode ─────────────────────────────────────────────────────────
let payload = {};
try {
  const raw = readFileSync(0, "utf8");
  if (raw.trim()) payload = JSON.parse(raw);
} catch { process.exit(0); }

const eventName = payload.hook_event_name || "";
if (eventName !== "Stop" && eventName !== "SubagentStop" && eventName !== "SessionEnd") {
  process.exit(0);
}

// SubagentStop: flush only this subagent. Live-feel: its trace appears
// in Langfuse before the orchestrator turn ends.
if (eventName === "SubagentStop" && payload.agent_transcript_path) {
  const tp = payload.agent_transcript_path;
  const sub = parseSubagentPath(tp);
  if (sub) {
    const scope = subagentScope(sub.rootSessionId, sub.agentId, payload.agent_type);
    await flushScope({
      transcriptPath: tp,
      scope,
      key: `${sub.rootSessionId}-${sub.agentId}`,
    });
  }
  process.exit(0);
}

// Stop or SessionEnd: flush orchestrator + sweep subagents. SessionEnd
// is the safety net for terminals closed mid-turn (Stop wouldn't fire).
// Subagent processes also fire Stop in some Claude Code versions;
// their transcript_path looks like a subagent path, so skip —
// SubagentStop already covered them.
if (eventName === "Stop" || eventName === "SessionEnd") {
  const tp = payload.transcript_path || "";
  if (parseSubagentPath(tp)) process.exit(0);

  const sid = payload.session_id
    || (tp ? tp.split("/").pop().replace(/\.jsonl$/, "") : "");
  if (!sid) process.exit(0);

  // fullRetail on Stop/SessionEnd: re-emit everything regardless of
  // cursor. Backstop for any event Langfuse accepted but dropped (the
  // trace-vs-observation race exists even with two-phase POSTs, just
  // less often). Deterministic IDs → Langfuse upserts → no double-
  // counting, just bandwidth.
  await flushScope({
    transcriptPath: tp,
    scope: orchestratorScope(sid),
    key: sid,
    fullRetail: true,
  });

  const subDir = tp ? join(tp.replace(/\.jsonl$/, ""), "subagents") : null;
  if (subDir && existsSync(subDir)) {
    let entries = [];
    try { entries = readdirSync(subDir); } catch { /* best-effort */ }
    for (const f of entries) {
      const m = f.match(/^agent-([0-9a-f]+)\.jsonl$/);
      if (!m) continue;
      const aid = m[1];
      const agentType = readMetaAgentType(subDir, aid);
      await flushScope({
        transcriptPath: join(subDir, f),
        scope: subagentScope(sid, aid, agentType),
        key: `${sid}-${aid}`,
        fullRetail: true,
      });
    }
  }
}

process.exit(0);
