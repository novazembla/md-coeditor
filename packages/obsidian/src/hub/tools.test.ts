import { history, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { NewEvent } from "../log/writer";
import { makeView } from "../test-util";
import { HubError } from "./server";
import { createToolHandlers, type VaultPort } from "./tools";

const CTX = { session: "s1", agent: "claude" };
const ID = /^[0-9a-z]{6}$/;

interface Setup {
	handlers: ReturnType<typeof createToolHandlers>;
	events: NewEvent[];
	notices: { text: string; path: string }[];
	processed: string[];
	files: Map<string, string>;
}

function setup(
	options: {
		files?: Record<string, string>;
		editors?: Record<string, EditorView>;
		active?: string | null;
	} = {},
): Setup {
	const files = new Map(Object.entries(options.files ?? {}));
	const editors = options.editors ?? {};
	const events: NewEvent[] = [];
	const notices: { text: string; path: string }[] = [];
	const processed: string[] = [];
	const active = options.active ?? null;
	const lower = new Map(
		[...files.keys(), ...Object.keys(editors)].map((p) => [p.toLowerCase(), p]),
	);
	const port: VaultPort = {
		activeNote: () => active,
		activeEditor: () => (active ? (editors[active] ?? null) : null),
		openEditor: (p) => editors[p] ?? null,
		resolve: (p) => lower.get(p.toLowerCase()) ?? null,
		read: async (p) => files.get(p) ?? "",
		process: async (p, fn) => {
			processed.push(p);
			const next = fn(files.get(p) ?? "");
			files.set(p, next);
			return next;
		},
		notice: (text, path) => notices.push({ text, path }),
	};
	const handlers = createToolHandlers({
		port,
		log: { append: (e) => events.push(e) },
		now: () => new Date(2026, 9, 25, 12, 0, 0),
	});
	return { handlers, events, notices, processed, files };
}

const edit = (find: string, replace: string, extra = {}) => ({
	path: "essay.md",
	find,
	replace,
	...extra,
});

function open(doc: string) {
	return makeView(doc, { extensions: history() });
}

async function code(p: Promise<unknown>): Promise<HubError> {
	try {
		await p;
	} catch (e) {
		if (e instanceof HubError) return e;
		throw e;
	}
	throw new Error("no error");
}

describe("suggest_edit in an open note", () => {
	it("keeps the cursor on the same text", async () => {
		const view = open("The quick fox|.");
		const { handlers } = setup({ editors: { "essay.md": view } });
		const r = (await handlers.suggest_edit(edit("quick", "slow"), CTX)) as {
			ids: string[];
		};
		expect(r.ids).toHaveLength(2);
		const doc = view.state.doc.toString();
		expect(doc).toMatch(
			/\{id="[^"]+" author="Claude" date="2026-10-25"--quick--\}/,
		);
		const head = view.state.selection.main.head;
		expect(view.state.sliceDoc(head - 3, head)).toBe("fox");
	});

	it("is removed by one undo", async () => {
		const view = open("The quick fox.");
		const { handlers } = setup({ editors: { "essay.md": view } });
		await handlers.suggest_edit(edit("quick", "slow"), CTX);
		undo(view);
		expect(view.state.doc.toString()).toBe("The quick fox.");
	});

	it("keeps typing right after a suggestion in its own undo step", async () => {
		const view = open("The quick fox.");
		const { handlers } = setup({ editors: { "essay.md": view } });
		await handlers.suggest_edit(edit("quick", "slow"), CTX);
		const end = view.state.doc.length;
		view.dispatch({
			changes: { from: end, insert: "!" },
			selection: EditorSelection.cursor(end + 1),
			userEvent: "input.type",
		});
		undo(view);
		expect(view.state.doc.toString().endsWith("!")).toBe(false);
		expect(view.state.doc.toString()).toContain("++slow++}");
		undo(view);
		expect(view.state.doc.toString()).toBe("The quick fox.");
	});

	it("never uses process", async () => {
		const view = open("The quick fox.");
		const s = setup({ editors: { "essay.md": view } });
		await s.handlers.suggest_edit(edit("quick", "slow"), CTX);
		expect(s.processed).toEqual([]);
	});
});

describe("suggest_edit in a closed note", () => {
	it("goes through process", async () => {
		const s = setup({ files: { "plan.md": "Ship in May.\r\n" } });
		await s.handlers.suggest_edit(
			{ path: "plan.md", find: "May", replace: "June" },
			CTX,
		);
		expect(s.processed).toEqual(["plan.md"]);
		const text = s.files.get("plan.md") as string;
		expect(text).toContain("--May--}");
		expect(text).toContain("++June++}");
		expect(text.endsWith(".\r\n")).toBe(true);
	});

	it("leaves the text unchanged on a refusal", async () => {
		const s = setup({ files: { "plan.md": "Ship in May.\n" } });
		const e = await code(
			s.handlers.suggest_edit(
				{ path: "plan.md", find: "June", replace: "July" },
				CTX,
			),
		);
		expect(e.code).toBe("not_found");
		expect(s.files.get("plan.md")).toBe("Ship in May.\n");
	});
});

describe("path checks", () => {
	const s = setup({ files: { "a.md": "x", "essay.md": "x" } });
	for (const [path, expected] of [
		["../secrets.md", "invalid_path"],
		["C:\\notes\\essay.md", "invalid_path"],
		["C:/notes/essay.md", "invalid_path"],
		["/abs.md", "invalid_path"],
		["a\\b.md", "invalid_path"],
		["./a.md", "invalid_path"],
		["a.txt", "invalid_path"],
		["nope.md", "note_not_found"],
	] as const) {
		it(`refuses ${path}`, async () => {
			for (const call of [
				s.handlers.read_note({ path }, CTX),
				s.handlers.suggest_edit({ path, find: "x", replace: "y" }, CTX),
			]) {
				expect((await code(call)).code).toBe(expected);
			}
		});
	}
	it("uses the real case of the path", async () => {
		const r = (await s.handlers.read_note({ path: "ESSAY.md" }, CTX)) as {
			path: string;
		};
		expect(r.path).toBe("essay.md");
	});
});

describe("notice", () => {
	it("is singular for one mark", async () => {
		const s = setup({
			files: { "plan.md": "Ship in May." },
			active: "essay.md",
		});
		await s.handlers.suggest_edit(
			{ path: "plan.md", find: "Ship in May.", replace: "Ship in May. Now." },
			CTX,
		);
		expect(s.notices).toEqual([
			{ text: "Claude suggested 1 change in plan.md", path: "plan.md" },
		]);
	});
	it("is plural for two marks", async () => {
		const s = setup({
			files: { "plan.md": "Ship in May." },
			active: "essay.md",
		});
		await s.handlers.suggest_edit(
			{ path: "plan.md", find: "May", replace: "June" },
			CTX,
		);
		expect(s.notices[0]?.text).toBe("Claude suggested 2 changes in plan.md");
	});
	it("is not shown for the active note", async () => {
		const view = open("The quick fox.");
		const s = setup({ editors: { "essay.md": view }, active: "essay.md" });
		await s.handlers.suggest_edit(edit("quick", "slow"), CTX);
		expect(s.notices).toEqual([]);
	});
});

describe("author, date and event", () => {
	it("uses the display name and the local date", async () => {
		const s = setup({ files: { "essay.md": "The quick fox." } });
		await s.handlers.suggest_edit(edit("quick", "slow"), CTX);
		const text = s.files.get("essay.md") as string;
		expect(text.match(/author="Claude" date="2026-10-25"/g)).toHaveLength(2);
	});
	it("capitalizes an unknown agent", async () => {
		const s = setup({ files: { "essay.md": "The quick fox." } });
		await s.handlers.suggest_edit(edit("quick", "slow"), {
			session: "s1",
			agent: "codex",
		});
		expect(s.files.get("essay.md")).toContain('author="Codex"');
	});
	it("logs a suggestion event with the real path", async () => {
		const s = setup({ files: { "Essay.md": "The quick fox, the quick end." } });
		const r = (await s.handlers.suggest_edit(
			{
				path: "essay.md",
				find: "quick fox",
				replace: "slow fox",
				before: "The ",
			},
			CTX,
		)) as { path: string; ids: string[] };
		expect(r.path).toBe("Essay.md");
		expect(s.events).toHaveLength(1);
		expect(s.events[0]).toEqual({
			type: "suggestion",
			path: "Essay.md",
			actor: "agent",
			agent: "claude",
			session: "s1",
			ids: r.ids,
			find: "quick fox",
			replace: "slow fox",
			before: "The ",
		});
		for (const id of r.ids) expect(id).toMatch(ID);
	});
	it("writes no event for a refusal", async () => {
		const s = setup({ files: { "essay.md": "a b a" } });
		await code(s.handlers.suggest_edit(edit("a", "c"), CTX));
		expect(s.events).toEqual([]);
	});
});

describe("refusals", () => {
	it("passes the details of ambiguous", async () => {
		const s = setup({ files: { "essay.md": "a cat and a cat" } });
		const e = await code(s.handlers.suggest_edit(edit("cat", "dog"), CTX));
		expect(e.code).toBe("ambiguous");
		expect(e.details).toEqual({ matches: 2 });
	});
	it("passes the ids of overlaps_mark", async () => {
		const view = open('A {id="i1bbbb"++new++} cat.');
		const s = setup({ editors: { "essay.md": view } });
		const e = await code(s.handlers.suggest_edit(edit("new", "old"), CTX));
		expect(e.code).toBe("overlaps_mark");
		expect((e.details as { ids: string[] }).ids).toContain("i1bbbb");
	});
});

describe("get_context", () => {
	it("returns null values without an active note", async () => {
		const s = setup();
		expect(await s.handlers.get_context({}, CTX)).toEqual({
			activeNote: null,
			selection: null,
			openMarks: null,
		});
	});

	it("counts open marks from the text when no editor view is open", async () => {
		const s = setup({
			files: { "essay.md": 'A {id="a1aaaa"++x++} B {id="b2bbbb"--y--}.' },
			active: "essay.md",
		});
		expect(await s.handlers.get_context({}, CTX)).toEqual({
			activeNote: "essay.md",
			selection: null,
			openMarks: 2,
		});
	});

	it("returns the selection and the open marks", async () => {
		const doc =
			'One.\nTwo.\nThe quick fox {id="a1aaaa"--x--} and {id="b2bbbb"++y++}.';
		const view = open(doc);
		const from = doc.indexOf("quick");
		view.dispatch({ selection: EditorSelection.range(from, from + 9) });
		const s = setup({ editors: { "essay.md": view }, active: "essay.md" });
		expect(await s.handlers.get_context({}, CTX)).toEqual({
			activeNote: "essay.md",
			selection: {
				text: "quick fox",
				start: { line: 3, ch: 4 },
				end: { line: 3, ch: 13 },
			},
			openMarks: 2,
		});
	});

	it("maps a selection after a pending deletion", async () => {
		const doc = "One.\nTwo.\nThe {--very --}quick fox.";
		const view = open(doc);
		const from = doc.indexOf("quick");
		view.dispatch({ selection: EditorSelection.range(from, from + 5) });
		const s = setup({ editors: { "essay.md": view }, active: "essay.md" });
		const r = (await s.handlers.get_context({}, CTX)) as {
			selection: unknown;
		};
		expect(r.selection).toEqual({
			text: "quick",
			// The agent view is "The quick fox.": the deletion is left out.
			start: { line: 3, ch: 4 },
			end: { line: 3, ch: 9 },
		});
	});

	it("returns null for an empty selection", async () => {
		const view = open("The |quick fox.");
		const s = setup({ editors: { "essay.md": view }, active: "essay.md" });
		expect(await s.handlers.get_context({}, CTX)).toMatchObject({
			selection: null,
			openMarks: 0,
		});
	});
});

describe("read_note", () => {
	it("shows a pending replace in the agent view", async () => {
		const text =
			'Line one.\nThe {id="d1dddd" author="Claude"--quick--}{id="i1iiii" author="Claude"++slow++} fox.';
		const s = setup({ files: { "essay.md": text } });
		expect(await s.handlers.read_note({ path: "essay.md" }, CTX)).toEqual({
			path: "essay.md",
			text: "Line one.\nThe slow fox.",
			marks: [
				{
					id: "d1dddd",
					kind: "deletion",
					author: "Claude",
					content: "quick",
					line: 2,
				},
				{
					id: "i1iiii",
					kind: "insertion",
					author: "Claude",
					content: "slow",
					line: 2,
				},
			],
		});
	});

	it("reads the editor text of an open note", async () => {
		const view = open("Unsaved text.");
		const s = setup({
			files: { "essay.md": "Disk." },
			editors: { "essay.md": view },
		});
		const r = (await s.handlers.read_note({ path: "essay.md" }, CTX)) as {
			text: string;
		};
		expect(r.text).toBe("Unsaved text.");
	});

	it("leaves out the id of a hand-typed mark", async () => {
		const s = setup({ files: { "plan.md": "One {++x++}.\n" } });
		const r = (await s.handlers.read_note({ path: "plan.md" }, CTX)) as {
			marks: Record<string, unknown>[];
		};
		expect(r.marks[0]).toBeDefined();
		expect("id" in (r.marks[0] as object)).toBe(false);
	});

	it("returns no carriage return for a note with Windows line ends", async () => {
		const s = setup({
			files: { "plan.md": "One.\r\nTwo {++x++}.\r\nThree.\r\n" },
		});
		const r = (await s.handlers.read_note({ path: "plan.md" }, CTX)) as {
			text: string;
			marks: { line: number }[];
		};
		expect(r.text).toBe("One.\nTwo x.\nThree.\n");
		expect(r.marks[0]?.line).toBe(2);
	});
});
