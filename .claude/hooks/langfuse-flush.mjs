#!/usr/bin/env node
// Langfuse trace forwarder — flush-on-stop, OpenTelemetry variant.
//
// Reads Claude Code transcripts (JSONL) and sends them to Langfuse as
// OTLP/HTTP JSON spans on /api/public/otel/v1/traces.
//
// Why OpenTelemetry:
//   Langfuse v4 defaults to LANGFUSE_MIGRATION_V4_WRITE_MODE=events_only.
//   In that mode /api/public/ingestion accepts only score events and
//   rejects trace-create / generation-create (207, one error per event).
//   OTLP is the v4 ingestion path. It also removes the old v3 race where a
//   generation arrived before its trace and was dropped: in OTLP the trace
//   is derived from the spans, so there is no separate trace-create to wait
//   for.
//
// What it does:
//   • SubagentStop → flush the finishing subagent's transcript.
//   • Stop (orchestrator only) → flush the orchestrator transcript + sweep
//     every subagent transcript under <sid>/subagents/ (safety net for a
//     SubagentStop flush that failed, or one that never fired).
//   • SessionEnd → same as Stop. Catches "terminal closed mid-turn".
//
// Span model (one Langfuse trace per transcript):
//   root span   type=agent, name = trace name, start/end = first/last
//               transcript line. Carries the trace attributes: name,
//               session.id, tags, input (first user message), output
//               (last assistant text), metadata. Sent on every flush, so
//               the trace end time and output follow the transcript.
//   generation  type=generation, child of the root span, one per Anthropic
//               message.id (stream-resume rows collapse into one).
//               Carries model, usage_details, input, output.
//   Subagent transcripts are their own traces with the orchestrator's
//   session.id, so they fold into one Langfuse Session and the session
//   total matches `/cost` (minus calls that are not in the transcript, see
//   "Known gaps").
//
// Cost:
//   The hook sends token counts only. Langfuse prices them from its model
//   catalog. Usage keys follow the catalog's price keys:
//     input, output, input_cache_read,
//     input_cache_creation_5m, input_cache_creation_1h
//   Claude Code writes 1h cache entries, which cost 2x input (5m entries:
//   1.25x). Sending one undivided cache_creation_input_tokens key makes
//   Langfuse price every write at the 5m rate and undercount.
//
// Correctness model:
//   • Per-transcript cursor (`.claude/.langfuse-flush/<key>.json`) records
//     the last forwarded line. Advances only on a successful POST. A failed
//     flush is retried from the same line on the next Stop. The transcript
//     on disk is the durable queue.
//   • Trace and span IDs are deterministic (sha256 of session id, agent id,
//     message.id). Langfuse upserts on span id, so re-sending lines is
//     idempotent and never inflates cost (verified against v4.70).
//   • The root span is re-sent on every flush with the whole-transcript
//     first input / last output, so incremental flushes keep it current.
//
// Known gaps:
//   • Claude Code makes some calls that are not written to the transcript
//     as assistant messages (small Haiku calls, some side requests). The
//     hook cannot see them. Expect Langfuse to be a few % below `/cost`.
//   • No per-tool spans and no live updates inside one long orchestrator
//     response — Stop fires per response, not per tool use.
//   • An orchestrator that crashes before Stop is not flushed. Use
//     --catchup.
//
// Plug-and-play:
//   No dependencies, Node 20+. Drop this file in .claude/hooks/, add
//   LANGFUSE_* to .env, and wire it in .claude/settings.json:
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
//       Re-send orchestrator + every subagent for one session, ignoring
//       cursors. Idempotent.
//   --flush-transcript <abs-jsonl-path>
//       Re-send one transcript from line 0.
//   --catchup [--max-age-hours N]
//       Scan ~/.claude/projects/<projectSlug>/ for transcripts whose cursor
//       is behind the file end, and flush each one. Default window: 72h.
//   --catchup-worktrees [--max-age-hours N]
//       Same scan over sibling slugs of sessions started in a worktree
//       under this project (<projectDir>/.claude/worktrees/<name>).
//   --catchup-all [--max-age-hours N]
//       Main slug + every worktree slug.
//   --force (with any --catchup* flag)
//       Ignore cursors: re-send every candidate in the age window. Use it
//       after a Langfuse model price changed (Langfuse prices at ingestion
//       time) or to migrate sessions sent by the old v3 script.
//
// Migrating sessions sent by the old /api/public/ingestion script:
//   The old script used trace ids `claude-<sid>` and `claude-<sid>-<agentId>`.
//   OTLP needs hex ids, so the same session gets a new trace id. Every full
//   re-send (--verify, --flush-transcript, --catchup* --force) first deletes
//   the old-format trace for that transcript (404 is ignored), so a session
//   is never counted twice. Normal Stop flushes never delete anything.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
// main `.git` from any worktree; its parent is the main checkout root.
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
const HOST = (env.LANGFUSE_HOST || "http://localhost:3001").replace(/\/+$/, "");
const PUBLIC_KEY = env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = env.LANGFUSE_SECRET_KEY;
// Enabled but misconfigured is a real error, unlike "disabled" above.
if (!PUBLIC_KEY || !SECRET_KEY) {
  const missing = [
    !PUBLIC_KEY && "LANGFUSE_PUBLIC_KEY",
    !SECRET_KEY && "LANGFUSE_SECRET_KEY",
  ].filter(Boolean).join(", ");
  process.stderr.write(`[langfuse-flush] LANGFUSE_ENABLED=true but missing ${missing} — skipping flush\n`);
  process.exit(0);
}
const AUTH = "Basic " + Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString("base64");
const TIMEOUT_MS = Number(env.LANGFUSE_TIMEOUT_MS || 10000);
// Spans per POST. Keeps each request well under ~1MB (input/output are
// truncated to 8000 chars per span).
const CHUNK_SIZE = Number(env.LANGFUSE_CHUNK_SIZE || 100);
const SCOPE_NAME = "claude-code-langfuse-flush";
const SCOPE_VERSION = "2";

// ─── small helpers ─────────────────────────────────────────────────────
function hash(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}
function truncate(v, max = 8000) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > max ? s.slice(0, max) + "…[truncated]" : s;
}
function toUnixNano(iso) {
  const ms = Date.parse(iso);
  return String(BigInt(Number.isFinite(ms) ? ms : Date.now()) * 1000000n);
}
function parseSubagentPath(tp) {
  const m = tp.match(/[\\/]([0-9a-f-]{36})[\\/]subagents[\\/]agent-([0-9a-f]+)\.jsonl$/);
  return m ? { rootSessionId: m[1], agentId: m[2] } : null;
}
function sessionIdFromPath(tp) {
  return basename(tp).replace(/\.jsonl$/, "");
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

// Anthropic usage → Langfuse usage_details. Key names match the price keys
// of Langfuse's managed Claude models. cache_creation_input_tokens is split
// by TTL; without the split (older API responses) all writes count as 5m.
function usageDetails(usage) {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const write1h = Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, cacheWrite);
  const details = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    input_cache_read: usage.cache_read_input_tokens ?? 0,
    input_cache_creation_5m: cacheWrite - write1h,
    input_cache_creation_1h: write1h,
  };
  for (const k of Object.keys(details)) if (!details[k]) delete details[k];
  return details;
}

// ─── OTLP attribute encoding ───────────────────────────────────────────
function otelValue(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(otelValue) } };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number" && Number.isInteger(v)) return { intValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  return { stringValue: JSON.stringify(v) };
}
function otelAttributes(obj) {
  const out = [];
  for (const [key, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out.push({ key, value: otelValue(v) });
  }
  return out;
}

// ─── cursors ───────────────────────────────────────────────────────────
// One file per transcript. Subagent keys are `<rootSid>-<agentId>`.
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

// ─── transcript → spans ────────────────────────────────────────────────
// Builds the root span (always) plus one generation span per message past
// `fromIndex`. Returns the spans and the new cursor index.
function buildScope({ transcriptPath, scope, fromIndex }) {
  if (!existsSync(transcriptPath)) return { spans: [], newIndex: fromIndex };
  let lines;
  try { lines = readFileSync(transcriptPath, "utf8").split("\n"); }
  catch { return { spans: [], newIndex: fromIndex }; }

  // Whole-transcript pass for the root span: first user message (trace
  // input), last assistant text (trace output), first/last timestamps.
  // Also primes lastUserInput so the first generation past the cursor has
  // the right `input`.
  let firstUserInput = null;
  let lastAssistantText = null;
  let firstTs = null;
  let lastTs = null;
  let lastUserInput = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    let d;
    try { d = JSON.parse(lines[i]); } catch { continue; }
    if (d.timestamp) {
      if (firstTs === null) firstTs = d.timestamp;
      lastTs = d.timestamp;
    }
    if (d.type === "user" && d.message) {
      const text = extractUserInput(d.message.content);
      if (firstUserInput === null) firstUserInput = text;
      if (i <= fromIndex) lastUserInput = text;
    } else if (d.type === "assistant" && d.message) {
      const text = extractAssistantOutput(d.message.content);
      if (text) lastAssistantText = text;
    }
  }
  const nowIso = new Date().toISOString();
  firstTs ??= nowIso;
  lastTs ??= firstTs;

  // Collapse rows by message.id. Anthropic stream-resume splits one message
  // across several JSONL rows that share message.id but interleave with
  // tool_result rows. Freeze `input` at the message's first row and
  // accumulate `output` across rows. Each row repeats the full-message
  // usage, so the latest row's usage is the message's usage.
  const genById = new Map(); // spanId → consolidated generation
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
    const ts = d.timestamp || nowIso;
    const outputText = extractAssistantOutput(m.content);
    const spanId = hash(`gen:${scope.rootSessionId}:${scope.agentId || "orch"}:${m.id || d.uuid || `${i}:${ts}`}`).slice(0, 16);
    const prev = genById.get(spanId);
    if (!prev) {
      genById.set(spanId, {
        spanId,
        start: ts,
        end: ts,
        model: m.model,
        input: lastUserInput,
        output: outputText || "",
        usage: m.usage || {},
        stopReason: m.stop_reason,
        messageUuid: d.uuid,
        requestId: d.requestId,
      });
    } else {
      if (outputText) prev.output = prev.output ? `${prev.output}\n\n${outputText}` : outputText;
      prev.end = ts;
      prev.usage = m.usage || prev.usage;
      if (m.stop_reason) prev.stopReason = m.stop_reason;
    }
  }

  const scopeMeta = {
    transcript: transcriptPath,
    root_session_id: scope.rootSessionId,
    is_subagent: scope.kind === "subagent",
    agent_id: scope.agentId,
    agent_type: scope.agentType,
  };
  const genName = `gen:${scope.agentType || (scope.kind === "subagent" ? "subagent" : "orchestrator")}`;

  const spans = [{
    traceId: scope.traceId,
    spanId: scope.rootSpanId,
    name: scope.traceName,
    kind: 1,
    startTimeUnixNano: toUnixNano(firstTs),
    endTimeUnixNano: toUnixNano(lastTs),
    attributes: otelAttributes({
      "langfuse.observation.type": "agent",
      "langfuse.trace.name": scope.traceName,
      "session.id": scope.rootSessionId,
      "langfuse.trace.tags": scope.kind === "subagent"
        ? ["claude-code", "subagent", scope.agentType].filter(Boolean)
        : ["claude-code"],
      "langfuse.trace.input": firstUserInput ?? undefined,
      "langfuse.trace.output": lastAssistantText ?? undefined,
      "langfuse.trace.metadata": JSON.stringify(scopeMeta),
      "langfuse.observation.input": firstUserInput ?? undefined,
      "langfuse.observation.output": lastAssistantText ?? undefined,
    }),
  }];

  for (const g of genById.values()) {
    spans.push({
      traceId: scope.traceId,
      spanId: g.spanId,
      parentSpanId: scope.rootSpanId,
      name: genName,
      kind: 1,
      startTimeUnixNano: toUnixNano(g.start),
      endTimeUnixNano: toUnixNano(g.end),
      attributes: otelAttributes({
        "langfuse.observation.type": "generation",
        "langfuse.observation.model.name": g.model,
        "langfuse.observation.model.parameters": g.stopReason
          ? JSON.stringify({ stop_reason: g.stopReason })
          : undefined,
        "langfuse.observation.usage_details": JSON.stringify(usageDetails(g.usage)),
        "langfuse.observation.input": g.input ?? undefined,
        "langfuse.observation.output": truncate(g.output) || undefined,
        "langfuse.observation.metadata": JSON.stringify({
          ...scopeMeta,
          message_uuid: g.messageUuid,
          request_id: g.requestId,
          stop_reason: g.stopReason,
        }),
      }),
    });
  }

  return { spans, newIndex };
}

// ─── OTLP POST ─────────────────────────────────────────────────────────
// Sends spans in CHUNK_SIZE groups. Returns true only when every chunk was
// accepted in full. Failures are logged with the server's reason, never
// thrown — telemetry must not block the agent.
async function postSpans(spans) {
  for (let i = 0; i < spans.length; i += CHUNK_SIZE) {
    const chunk = spans.slice(i, i + CHUNK_SIZE);
    const body = {
      resourceSpans: [{
        resource: { attributes: otelAttributes({ "service.name": "claude-code" }) },
        scopeSpans: [{ scope: { name: SCOPE_NAME, version: SCOPE_VERSION }, spans: chunk }],
      }],
    };
    let res;
    try {
      res = await fetch(`${HOST}/api/public/otel/v1/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      process.stderr.write(`[langfuse-flush] POST error chunk ${i}: ${e.message}\n`);
      return false;
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      process.stderr.write(`[langfuse-flush] POST ${res.status} on chunk ${i}: ${text.slice(0, 500)}\n`);
      return false;
    }
    // OTLP partial success: 2xx with rejected spans.
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON — treat as ok */ }
    const rejected = Number(parsed?.partialSuccess?.rejectedSpans ?? 0);
    if (rejected > 0) {
      process.stderr.write(`[langfuse-flush] ${rejected} span(s) rejected on chunk ${i}: ${parsed.partialSuccess.errorMessage ?? ""}\n`);
      return false;
    }
  }
  return true;
}

// Deletes the trace the old /api/public/ingestion script created for this
// scope. Only called from full re-sends, so a migrated session is never
// counted twice. 404 = nothing to delete.
async function deleteLegacyTrace(scope) {
  try {
    const res = await fetch(`${HOST}/api/public/traces/${encodeURIComponent(scope.legacyTraceId)}`, {
      method: "DELETE",
      headers: { Authorization: AUTH },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) process.stderr.write(`[langfuse-flush] deleted legacy trace ${scope.legacyTraceId}\n`);
    else if (res.status !== 404) process.stderr.write(`[langfuse-flush] legacy delete ${scope.legacyTraceId}: ${res.status}\n`);
  } catch (e) {
    process.stderr.write(`[langfuse-flush] legacy delete ${scope.legacyTraceId}: ${e.message}\n`);
  }
}

// ─── flush one scope ───────────────────────────────────────────────────
// full: ignore the cursor and re-send every line (manual recovery paths).
// The cursor still advances to newIndex on success.
async function flushScope({ transcriptPath, scope, key, full = false }) {
  const cursor = readCursor(key);
  const fromIndex = full ? -1 : cursor.lastLineIndex;
  const { spans, newIndex } = buildScope({ transcriptPath, scope, fromIndex });
  if (!full && newIndex === cursor.lastLineIndex) return true;
  if (spans.length === 0) return true;
  if (full) await deleteLegacyTrace(scope);
  const ok = await postSpans(spans);
  if (!ok) return false;
  cursor.lastLineIndex = newIndex;
  writeCursor(key, cursor);
  return true;
}

// ─── scope builders ────────────────────────────────────────────────────
// OTLP ids are hex: traceId 32 chars, spanId 16 chars. The orchestrator's
// session id is a UUID, so its hex digits are the trace id — easy to look
// up in Langfuse by session id.
function subagentScope(rootSessionId, agentId, agentType) {
  return {
    kind: "subagent",
    traceId: hash(`trace:${rootSessionId}:${agentId}`).slice(0, 32),
    rootSpanId: hash(`root:${rootSessionId}:${agentId}`).slice(0, 16),
    legacyTraceId: `claude-${rootSessionId}-${agentId}`,
    rootSessionId,
    agentId,
    agentType,
    traceName: `claude-code:subagent ${agentType || ""} ${agentId.slice(0, 8)}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}
function orchestratorScope(rootSessionId) {
  const hex = rootSessionId.replace(/-/g, "").toLowerCase();
  return {
    kind: "orchestrator",
    traceId: /^[0-9a-f]{32}$/.test(hex) ? hex : hash(`trace:${rootSessionId}`).slice(0, 32),
    rootSpanId: hash(`root:${rootSessionId}:orch`).slice(0, 16),
    legacyTraceId: `claude-${rootSessionId}`,
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
function listSubagents(subDir) {
  if (!existsSync(subDir)) return [];
  let entries = [];
  try { entries = readdirSync(subDir); } catch { return []; }
  const out = [];
  for (const f of entries) {
    const m = f.match(/^agent-([0-9a-f]+)\.jsonl$/);
    if (m) out.push({ file: join(subDir, f), agentId: m[1], agentType: readMetaAgentType(subDir, m[1]) });
  }
  return out;
}

// ─── manual recovery: --catchup ────────────────────────────────────────
// Claude Code names each transcript dir after the session's cwd, with
// `/` (and `.`) collapsed to `-`. A session started in a worktree under
// this project gets its own slug that starts with the main slug.
//   "main"      → this checkout's slug; falls back to every project dir
//                 if this slug isn't on disk yet.
//   "worktrees" → only sibling slugs nested under this project's path.
//   "all"       → main + worktrees.
function projectSlug() {
  return projectDir.replace(/[\\/.:]/g, "-");
}
function catchupSlugs(projectsRoot, mode) {
  const expectedSlug = projectSlug();
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
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) {
    process.stderr.write("[langfuse-flush] no ~/.claude/projects dir — nothing to catch up\n");
    return 0;
  }
  const candidates = catchupSlugs(projectsRoot, mode);
  if (mode !== "main") {
    process.stderr.write(`[langfuse-flush] catchup mode=${mode}: ${candidates.length} slug(s)\n`);
    for (const s of candidates) process.stderr.write(`[langfuse-flush]   ${s}\n`);
  }

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 3600 * 1000;
  const minQuietMs = 60 * 1000;
  const inWindow = (p) => {
    try {
      const age = now - statSync(p).mtimeMs;
      return age <= maxAgeMs && age >= minQuietMs; // skip too old / still being written
    } catch { return false; }
  };
  const targets = [];
  for (const slug of candidates) {
    const dir = join(projectsRoot, slug);
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const tp = join(dir, f);
      if (!inWindow(tp)) continue;
      const sid = f.replace(/\.jsonl$/, "");
      targets.push({ tp, scope: orchestratorScope(sid), key: sid });
      for (const sa of listSubagents(join(dir, sid, "subagents"))) {
        if (!inWindow(sa.file)) continue;
        targets.push({ tp: sa.file, scope: subagentScope(sid, sa.agentId, sa.agentType), key: `${sid}-${sa.agentId}` });
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
    if (!force && cursor.lastLineIndex >= lineCount - 1) {
      upToDate++;
      continue;
    }
    process.stderr.write(`[langfuse-flush] catchup${force ? " (forced)" : ""}: ${t.tp} (cursor ${cursor.lastLineIndex}, end ${lineCount - 1})\n`);
    const ok = await flushScope({ transcriptPath: t.tp, scope: t.scope, key: t.key, full: force });
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
  const maxAgeHours = maxAgeFlag !== -1 ? Number(process.argv[maxAgeFlag + 1]) : 72;
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
    scope = subagentScope(sub.rootSessionId, sub.agentId, readMetaAgentType(dirname(tp), sub.agentId));
    key = `${sub.rootSessionId}-${sub.agentId}`;
  } else {
    const sid = sessionIdFromPath(tp);
    scope = orchestratorScope(sid);
    key = sid;
  }
  const ok = await flushScope({ transcriptPath: tp, scope, key, full: true });
  process.exit(ok ? 0 : 2);
}

// ─── manual recovery: --verify <sid> ───────────────────────────────────
const verifyIdx = process.argv.indexOf("--verify");
if (verifyIdx !== -1) {
  const sid = process.argv[verifyIdx + 1];
  if (!sid) {
    process.stderr.write("[langfuse-flush] --verify requires a session id\n");
    process.exit(1);
  }
  const slugRoot = join(homedir(), ".claude", "projects", projectSlug());
  const orchPath = join(slugRoot, `${sid}.jsonl`);
  if (!existsSync(orchPath)) {
    process.stderr.write(`[langfuse-flush] no transcript at ${orchPath}\n`);
    process.exit(1);
  }
  process.stderr.write(`[langfuse-flush] verify: orchestrator ${sid}\n`);
  let allOk = await flushScope({ transcriptPath: orchPath, scope: orchestratorScope(sid), key: sid, full: true });
  for (const sa of listSubagents(join(slugRoot, sid, "subagents"))) {
    process.stderr.write(`[langfuse-flush] verify: subagent ${sa.agentId} (${sa.agentType || "?"})\n`);
    const ok = await flushScope({
      transcriptPath: sa.file,
      scope: subagentScope(sid, sa.agentId, sa.agentType),
      key: `${sid}-${sa.agentId}`,
      full: true,
    });
    if (!ok) allOk = false;
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

// SubagentStop: flush only this subagent, so it shows up in Langfuse
// before the orchestrator turn ends.
if (eventName === "SubagentStop" && payload.agent_transcript_path) {
  const tp = payload.agent_transcript_path;
  const sub = parseSubagentPath(tp);
  if (sub) {
    await flushScope({
      transcriptPath: tp,
      scope: subagentScope(sub.rootSessionId, sub.agentId, payload.agent_type),
      key: `${sub.rootSessionId}-${sub.agentId}`,
    });
  }
  process.exit(0);
}

// Stop or SessionEnd: flush orchestrator + sweep subagents. Some Claude
// Code versions also fire Stop in subagent processes; their
// transcript_path is a subagent path — SubagentStop already covered them.
if (eventName === "Stop" || eventName === "SessionEnd") {
  const tp = payload.transcript_path || "";
  if (parseSubagentPath(tp)) process.exit(0);
  const sid = payload.session_id || (tp ? sessionIdFromPath(tp) : "");
  if (!sid || !tp) process.exit(0);

  await flushScope({ transcriptPath: tp, scope: orchestratorScope(sid), key: sid });
  for (const sa of listSubagents(join(tp.replace(/\.jsonl$/, ""), "subagents"))) {
    await flushScope({
      transcriptPath: sa.file,
      scope: subagentScope(sid, sa.agentId, sa.agentType),
      key: `${sid}-${sa.agentId}`,
    });
  }
}

process.exit(0);
