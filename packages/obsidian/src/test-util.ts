import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach } from "vitest";
import { coeditExtension } from "./extension";

const views: EditorView[] = [];

afterEach(() => {
	for (const view of views.splice(0)) {
		view.dom.parentElement?.remove();
		view.destroy();
	}
});

/**
 * An `EditorView` in jsdom with `coeditExtension`. `|` in `doc` marks the
 * cursor and is removed.
 */
export function makeView(
	doc: string,
	options: { live?: boolean; extensions?: Extension } = {},
): EditorView {
	const cursor = doc.indexOf("|");
	const text =
		cursor === -1 ? doc : doc.slice(0, cursor) + doc.slice(cursor + 1);
	const parent = document.createElement("div");
	document.body.append(parent);
	const live = options.live ?? true;
	const view = new EditorView({
		doc: text,
		selection: EditorSelection.cursor(cursor === -1 ? 0 : cursor),
		extensions: [
			coeditExtension({ isLivePreview: () => live }),
			options.extensions ?? [],
		],
		parent,
	});
	views.push(view);
	return view;
}

/** The visible text of each line. */
export function visibleLines(view: EditorView): string[] {
	return [...view.contentDOM.querySelectorAll(".cm-line")].map(
		(line) => line.textContent ?? "",
	);
}

/** Text and class of each change span, in order. */
export function changeSpans(
	view: EditorView,
): { text: string; cls: string; label: string | null }[] {
	return [...view.contentDOM.querySelectorAll(".coedit-ins, .coedit-del")].map(
		(el) => ({
			text: el.textContent ?? "",
			cls: el.className,
			label: el.getAttribute("aria-label"),
		}),
	);
}

/** Position directly after the first occurrence of `find` in the document. */
export function after(view: EditorView, find: string): number {
	const at = view.state.doc.toString().indexOf(find);
	if (at === -1) throw new Error(`"${find}" not in the document`);
	return at + find.length;
}

/** Position directly before the first occurrence of `find` in the document. */
export function before(view: EditorView, find: string): number {
	return after(view, find) - find.length;
}
