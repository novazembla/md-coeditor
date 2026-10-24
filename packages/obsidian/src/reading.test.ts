import { describe, expect, test } from "vitest";
import { renderChanges } from "./reading";

/** A section like Obsidian's Reading view renders it. */
function section(html: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = html;
	renderChanges(el);
	return el;
}

function spans(el: HTMLElement) {
	return [...el.querySelectorAll(".coedit-ins, .coedit-del")].map((s) => ({
		text: s.textContent,
		cls: s.className,
		label: s.getAttribute("aria-label"),
	}));
}

describe("renderChanges", () => {
	test("a replace in a paragraph", () => {
		const el = section(
			'<p>The {id="d1" author="Claude" date="2026-10-24"--cat--}{id="a1"++dog++} sat.</p>',
		);
		expect(el.textContent).toBe("The catdog sat.");
		expect(spans(el)).toEqual([
			{ text: "cat", cls: "coedit-del", label: "Claude, 2026-10-24" },
			{ text: "dog", cls: "coedit-ins", label: "Unknown author" },
		]);
	});

	test("a mark around strong: formatting stays", () => {
		const el = section('<p>A {id="a1"++<strong>bold</strong> idea++}.</p>');
		expect(el.textContent).toBe("A bold idea.");
		expect(spans(el).map((s) => s.text)).toEqual(["bold", " idea"]);
		expect(el.querySelector("strong .coedit-ins")?.textContent).toBe("bold");
	});

	test("a mark over a line break", () => {
		const el = section('<p>{id="a1"++one<br>\ntwo++} end</p>');
		expect(el.textContent).toBe("one\ntwo end");
		expect(el.querySelector("br")).not.toBeNull();
		expect(spans(el).map((s) => s.text)).toEqual(["one", "\ntwo"]);
	});

	test("mark syntax in inline code stays", () => {
		const html = "<p>Use <code>{++x++}</code> here.</p>";
		const el = section(html);
		expect(el.innerHTML).toBe(html);
	});

	test("mark syntax in a code block stays", () => {
		const html = "<pre><code>{++x++}\n</code></pre>";
		expect(section(html).innerHTML).toBe(html);
	});

	test("mark syntax in a table stays", () => {
		const html =
			"<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>{++x++}</td></tr></tbody></table>";
		expect(section(html).innerHTML).toBe(html);
	});

	test("a substitution stays", () => {
		const html = "<p>A {~~cat~&gt;dog~~} sat.</p>";
		expect(section(html).innerHTML).toBe(html);
	});

	test("no mark across two list items", () => {
		const html = "<ul><li>a {++b</li><li>c++} d</li></ul>";
		expect(section(html).innerHTML).toBe(html);
	});

	test("a mark inside one list item", () => {
		const el = section("<ul><li>a {++b++}</li><li>c</li></ul>");
		expect(el.textContent).toBe("a bc");
		expect(spans(el).map((s) => s.text)).toEqual(["b"]);
	});

	test("running it again changes nothing", () => {
		const el = section('<p>The {id="a1"++big ++}cat.</p>');
		const html = el.innerHTML;
		renderChanges(el);
		expect(el.innerHTML).toBe(html);
	});
});
