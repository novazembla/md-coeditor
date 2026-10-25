import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { parse, project, suggest } from "@md-coeditor/format";
import type {
	GetContextResult,
	NoteMark,
	Position,
	ReadNoteParams,
	ReadNoteResult,
	SuggestEditParams,
	SuggestEditResult,
} from "@md-coeditor/protocol";
import type { NewEvent } from "../log/writer";
import { type Handler, HubError } from "./server";

/** What the hub tools need from the app. The real one is `obsidian-port.ts`. */
export interface VaultPort {
	/** Vault path of the active Markdown note, or null. */
	activeNote(): string | null;
	/** Editor view of the active note, or null. */
	activeEditor(): EditorView | null;
	/** Editor that shows the note: the active pane first, else the last focused. */
	openEditor(path: string): EditorView | null;
	/** Read, change and write a closed note in one step. Returns the new text. */
	process(path: string, fn: (text: string) => string): Promise<string>;
	read(path: string): Promise<string>;
	/** The real-case `TFile.path` of a note, or null when it does not exist. */
	resolve(path: string): string | null;
	notice(text: string, path: string): void;
}

export interface EventSink {
	append(event: NewEvent): void;
}

export interface ToolOptions {
	port: VaultPort;
	log: EventSink;
	/** Clock for the date of the marks. Default: the system clock. */
	now?: () => Date;
}

const DISPLAY_NAMES: Record<string, string> = { claude: "Claude" };

export function displayName(agent: string): string {
	return DISPLAY_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1);
}

function localDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Path check (D8). Returns the error message, or null for a valid path. */
export function pathProblem(path: string): string | null {
	if (path.includes("\\")) return "The path must use / and no backslash.";
	if (/^[A-Za-z]:/.test(path)) return "The path must not have a drive letter.";
	if (path.startsWith("/")) return "The path must be relative to the vault.";
	if (path.split("/").some((s) => s === "." || s === ".."))
		return "The path must not have a . or .. segment.";
	if (!path.endsWith(".md")) return "The path must end in .md.";
	return null;
}

function checkedPath(port: VaultPort, path: string): string {
	const problem = pathProblem(path);
	if (problem !== null) throw new HubError("invalid_path", problem);
	const real = port.resolve(path);
	if (real === null)
		throw new HubError("note_not_found", `No note at ${path}.`);
	return real;
}

/** Line (1-based) and ch (0-based) of a position in view text. */
function positionIn(text: string, pos: number): Position {
	let line = 1;
	let lineStart = 0;
	for (
		let i = text.indexOf("\n");
		i !== -1 && i < pos;
		i = text.indexOf("\n", i + 1)
	) {
		line++;
		lineStart = i + 1;
	}
	return { line, ch: pos - lineStart };
}

const clamp = (n: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, n));

/** Map a note position to the agent view with the marks of `project`. */
function toView(view: ReturnType<typeof project>, pos: number): number {
	let offset = 0; // note - view, after the marks that end before `pos`
	for (const { mark, start, end } of view.marks) {
		if (mark.end <= pos) {
			offset = mark.end - end;
			continue;
		}
		if (mark.start >= pos) break;
		// Inside a mark: the position goes into its visible content, else clamps.
		if (mark.kind === "insertion" || mark.kind === "highlight")
			return start + clamp(pos - mark.contentStart, 0, end - start);
		if (mark.kind === "substitution")
			return (
				start + clamp(pos - (mark.contentEnd - (end - start)), 0, end - start)
			);
		return start;
	}
	return pos - offset;
}

function countPending(text: string): number {
	return parse(text).marks.filter(
		(m) => m.kind === "insertion" || m.kind === "deletion",
	).length;
}

export function createToolHandlers(options: ToolOptions): {
	get_context: Handler;
	read_note: Handler;
	suggest_edit: Handler;
} {
	const { port, log } = options;
	const now = options.now ?? (() => new Date());

	const get_context: Handler = async () => {
		const activeNote = port.activeNote();
		if (activeNote === null)
			return {
				activeNote: null,
				selection: null,
				openMarks: null,
			} satisfies GetContextResult;
		const editor = port.activeEditor();
		if (editor === null)
			return {
				activeNote,
				selection: null,
				openMarks: countPending(await port.read(activeNote)),
			};
		const text = editor.state.doc.toString();
		const view = project(text);
		const { from, to } = editor.state.selection.main;
		let selection: GetContextResult["selection"] = null;
		if (from !== to) {
			const a = toView(view, from);
			const b = toView(view, to);
			const picked = view.text.slice(a, b).replace(/\r/g, "");
			if (picked !== "")
				selection = {
					text: picked,
					start: positionIn(view.text, a),
					end: positionIn(view.text, b),
				};
		}
		return { activeNote, selection, openMarks: countPending(text) };
	};

	const read_note: Handler = async (params) => {
		const { path } = params as ReadNoteParams;
		const real = checkedPath(port, path);
		const editor = port.openEditor(real);
		const text = editor ? editor.state.doc.toString() : await port.read(real);
		const view = project(text);
		const marks: NoteMark[] = [];
		for (const { mark, start } of view.marks) {
			if (mark.kind !== "insertion" && mark.kind !== "deletion") continue;
			const entry: NoteMark = {
				...(mark.id !== undefined && { id: mark.id }),
				kind: mark.kind,
				content: mark.content.replace(/\r/g, ""),
				line: positionIn(view.text, start).line,
			};
			if (mark.author !== undefined) entry.author = mark.author;
			marks.push(entry);
		}
		return {
			path: real,
			text: view.text.replace(/\r\n/g, "\n"),
			marks,
		} satisfies ReadNoteResult;
	};

	const suggest_edit: Handler = async (params, ctx) => {
		const p = params as SuggestEditParams;
		const real = checkedPath(port, p.path);
		const author = displayName(ctx.agent);
		const input = {
			find: p.find,
			replace: p.replace,
			...(p.before !== undefined && { before: p.before }),
			...(p.after !== undefined && { after: p.after }),
			author,
			date: localDate(now()),
		};

		let ids: string[];
		const editor = port.openEditor(real);
		if (editor) {
			const result = suggest(editor.state.doc.toString(), input);
			if (!result.ok)
				throw new HubError(result.code, result.message, result.details);
			editor.dispatch({
				changes: result.changes,
				userEvent: "coedit.suggest",
				annotations: isolateHistory.of("full"),
			});
			ids = result.marks.map((m) => m.id ?? "");
		} else {
			const refused: HubError[] = [];
			let made: string[] = [];
			await port.process(real, (text) => {
				const result = suggest(text, input);
				if (!result.ok) {
					refused.push(
						new HubError(result.code, result.message, result.details),
					);
					return text;
				}
				made = result.marks.map((m) => m.id ?? "");
				return result.text;
			});
			if (refused[0]) throw refused[0];
			ids = made;
		}

		log.append({
			type: "suggestion",
			path: real,
			actor: "agent",
			agent: ctx.agent,
			session: ctx.session,
			ids,
			find: p.find,
			replace: p.replace,
			...(p.before !== undefined && { before: p.before }),
			...(p.after !== undefined && { after: p.after }),
		});
		if (port.activeNote() !== real) {
			const n = ids.length;
			port.notice(
				`${author} suggested ${n === 1 ? "1 change" : `${n} changes`} in ${real}`,
				real,
			);
		}
		return { path: real, ids } satisfies SuggestEditResult;
	};

	return { get_context, read_note, suggest_edit };
}
