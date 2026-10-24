import { parse } from "@md-coeditor/format";
import { type ChangeMark, hiddenRanges, isChange, tooltip } from "./marks";
import { DELETION_CLASS, INSERTION_CLASS } from "./render";

/** Rendered protected zones: code, code blocks, tables, frontmatter. */
const SKIP = "code, pre, table, .frontmatter, .metadata-container";
/** Elements whose text is a block of its own. */
const BLOCK =
	"p, li, h1, h2, h3, h4, h5, h6, blockquote, div, td, th, dt, dd, figcaption";

interface Piece {
	node: Text;
	/** Range of the node's text in the joined text. */
	start: number;
	end: number;
}

interface Span {
	from: number;
	to: number;
	/** Undefined: remove the text (hidden syntax). */
	mark?: ChangeMark;
}

function textPieces(el: HTMLElement): { text: string; pieces: Piece[] } {
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const pieces: Piece[] = [];
	let text = "";
	let block: Element | null | undefined;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement;
		if (!parent || parent.closest(SKIP)) continue;
		const nodeBlock = parent.closest(BLOCK);
		// A blank line between blocks, so no mark is found across them.
		if (block !== undefined && nodeBlock !== block) text += "\n\n";
		block = nodeBlock;
		const value = node.nodeValue ?? "";
		pieces.push({
			node: node as Text,
			start: text.length,
			end: text.length + value.length,
		});
		text += value;
	}
	return { text, pieces };
}

function rewrite(piece: Piece, spans: readonly Span[]): void {
	const { node, start, end } = piece;
	const value = node.nodeValue ?? "";
	const doc = node.ownerDocument;
	const out: Node[] = [];
	let at = start;
	const plain = (to: number) => {
		if (to > at)
			out.push(doc.createTextNode(value.slice(at - start, to - start)));
	};
	for (const span of spans) {
		if (span.to <= start || span.from >= end) continue;
		const from = Math.max(span.from, start);
		const to = Math.min(span.to, end);
		plain(from);
		if (span.mark) {
			const el = doc.createElement("span");
			el.className =
				span.mark.kind === "insertion" ? INSERTION_CLASS : DELETION_CLASS;
			el.setAttribute("aria-label", tooltip(span.mark));
			el.textContent = value.slice(from - start, to - start);
			out.push(el);
		}
		at = to;
	}
	if (at === start) return;
	plain(end);
	node.replaceWith(...out);
}

/**
 * Show the insertions and deletions in a section rendered by Reading view:
 * remove their syntax and wrap their content in the change classes. Text in
 * code, tables and frontmatter is not changed. Formatting inside a mark stays:
 * content across a `strong` gives one span on each side.
 */
export function renderChanges(el: HTMLElement): void {
	const { text, pieces } = textPieces(el);
	if (!text.includes("{")) return;
	const spans: Span[] = [];
	for (const mark of parse(text).marks) {
		if (!isChange(mark)) continue;
		for (const [from, to] of hiddenRanges(mark)) spans.push({ from, to });
		if (mark.contentStart < mark.contentEnd)
			spans.push({ from: mark.contentStart, to: mark.contentEnd, mark });
	}
	if (spans.length === 0) return;
	spans.sort((a, b) => a.from - b.from);
	for (const piece of pieces) rewrite(piece, spans);
}
