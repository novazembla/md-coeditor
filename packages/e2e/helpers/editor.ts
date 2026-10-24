import { browser } from "@wdio/globals";
import { waitFor } from "./wait";

export type Mode = "live" | "source" | "reading";

/** A place in a text: an offset, or directly before or after the first match of a text. */
export type Place = number | { before: string } | { after: string };

/** The offset of a place in `doc`. */
export function at(doc: string, place: Place): number {
	if (typeof place === "number") return place;
	const text = "before" in place ? place.before : place.after;
	const i = doc.indexOf(text);
	if (i < 0) throw new Error(`not in the text: ${JSON.stringify(text)}`);
	return "before" in place ? i : i + text.length;
}

/** Open a note in the main tab in Live Preview, Source mode or Reading view, and wait until the view is ready. */
export async function openNote(
	path: string,
	mode: Mode = "live",
): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, path, mode) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: "markdown",
				state: {
					file: path,
					mode: mode === "reading" ? "preview" : "source",
					source: mode === "source",
				},
				active: true,
			});
			app.workspace.setActiveLeaf(leaf, { focus: true });
		},
		path,
		mode,
	);
	await waitFor(
		() =>
			browser.executeObsidian(({ app, obsidian }, path) => {
				const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
				if (!view || view.file?.path !== path) return "none";
				if (view.getMode() === "preview") {
					const el = view.containerEl.querySelector(
						".markdown-preview-view .markdown-preview-section",
					);
					return el && el.childElementCount > 1 ? "reading" : "loading";
				}
				const source = view.containerEl.querySelector(".markdown-source-view");
				if (!source?.querySelector(".cm-line")) return "loading";
				return source.classList.contains("is-live-preview") ? "live" : "source";
			}, path),
		(m) => m === mode,
		`open ${path} in ${mode}`,
	);
}

/** Put the cursor at an offset in the editor text and give the editor the focus. */
export async function setCursor(offset: number): Promise<void> {
	await browser.executeObsidian(({ app, obsidian }, offset) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error("no Markdown view");
		view.editor.focus();
		view.editor.setCursor(view.editor.offsetToPos(offset));
	}, offset);
	await waitFor(cursor, (c) => c === offset, `cursor at ${offset}`);
}

/** The cursor as an offset in the editor text. */
export function cursor(): Promise<number> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error("no Markdown view");
		return view.editor.posToOffset(view.editor.getCursor());
	});
}

/** The editor text of the active note. */
export function docText(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error("no Markdown view");
		return view.editor.getValue();
	});
}

/** The visible text of the rendered paragraphs in Reading view. */
export function readingText(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		const el = view?.containerEl.querySelector(".markdown-preview-view p");
		return el?.textContent ?? "";
	});
}

/** A styled part of a rendered line: its text, change class, colour and text decoration. */
export interface Part {
	text: string;
	cls: "coedit-ins" | "coedit-del" | null;
	/** True when the colour is `--color-green` (insertion) or `--color-red` (deletion) of the theme. */
	color: "green" | "red" | null;
	decoration: string;
}

/**
 * The visible text and the styled parts of a rendered line: line `n` (1-based) of the
 * editor, or paragraph `n` in Reading view.
 */
export function renderedLine(
	n: number,
): Promise<{ text: string; parts: Part[] }> {
	return browser.executeObsidian(({ app, obsidian }, n) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error("no Markdown view");
		const sel =
			view.getMode() === "preview"
				? ".markdown-preview-view p"
				: ".cm-content > .cm-line";
		const line = view.containerEl.querySelectorAll(sel)[n - 1];
		if (!line) throw new Error(`no line ${n}`);
		const probe = document.createElement("span");
		document.body.append(probe);
		const resolve = (v: string) => {
			probe.style.color = `var(${v})`;
			return getComputedStyle(probe).color;
		};
		const green = resolve("--color-green");
		const red = resolve("--color-red");
		probe.remove();
		const parts: Part[] = [];
		const walk = (node: Node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent ?? "";
				if (text === "") return;
				const el = node.parentElement as HTMLElement;
				const change = el.closest(".coedit-ins, .coedit-del");
				const style = getComputedStyle(el);
				parts.push({
					text,
					cls: change
						? change.classList.contains("coedit-ins")
							? "coedit-ins"
							: "coedit-del"
						: null,
					color:
						style.color === green
							? "green"
							: style.color === red
								? "red"
								: null,
					decoration: style.textDecorationLine,
				});
				return;
			}
			for (const child of node.childNodes) walk(child);
		};
		walk(line);
		return { text: line.textContent ?? "", parts };
	}, n);
}
