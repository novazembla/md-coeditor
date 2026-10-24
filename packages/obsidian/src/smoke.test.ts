import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";

test("EditorView runs in jsdom", () => {
	const parent = document.createElement("div");
	document.body.append(parent);
	const view = new EditorView({
		state: EditorState.create({ doc: "Hello, world" }),
		parent,
	});
	expect(view.state.doc.toString()).toBe("Hello, world");
	view.destroy();
	parent.remove();
});
