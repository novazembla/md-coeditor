import type { EditorView } from "@codemirror/view";
import type { Decision } from "@md-coeditor/format";
import { type Editor, editorLivePreviewField, Notice, Plugin } from "obsidian";
import { menuPos, runDecision } from "./decide";
import { coeditExtension } from "./extension";
import { isLivePreview } from "./marks";
import { runNextChange } from "./navigate";
import { renderChanges } from "./reading";

/** The CodeMirror view of an Obsidian editor (not in the public types). */
function cmView(editor: Editor): EditorView {
	return (editor as Editor & { cm: EditorView }).cm;
}

function notify(notice: string | null): void {
	if (notice !== null) new Notice(notice);
}

const DECISIONS: {
	id: string;
	name: string;
	icon: string;
	decision: Decision;
}[] = [
	{
		id: "accept-change",
		name: "Accept change",
		icon: "check",
		decision: "accept",
	},
	{ id: "reject-change", name: "Reject change", icon: "x", decision: "reject" },
];

const MOVES: { id: string; name: string; dir: 1 | -1 }[] = [
	{ id: "next-change", name: "Go to next change", dir: 1 },
	{ id: "previous-change", name: "Go to previous change", dir: -1 },
];

export default class MdCoeditorPlugin extends Plugin {
	override async onload(): Promise<void> {
		this.registerEditorExtension(
			coeditExtension({
				isLivePreview: (state) =>
					state.field(editorLivePreviewField, false) ?? false,
			}),
		);

		for (const { id, name, decision } of DECISIONS) {
			this.addCommand({
				id,
				name,
				editorCheckCallback: (checking, editor) => {
					const view = cmView(editor);
					if (!isLivePreview(view.state)) return false;
					if (!checking)
						notify(runDecision(view, view.state.selection.main.head, decision));
					return true;
				},
			});
		}

		for (const { id, name, dir } of MOVES) {
			this.addCommand({
				id,
				name,
				editorCheckCallback: (checking, editor) => {
					const view = cmView(editor);
					if (!isLivePreview(view.state)) return false;
					if (!checking) notify(runNextChange(view, dir));
					return true;
				},
			});
		}

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const view = cmView(editor);
				if (!isLivePreview(view.state)) return;
				const pos = menuPos(view.state);
				if (pos === null) return;
				for (const { name, icon, decision } of DECISIONS) {
					menu.addItem((item) =>
						item
							.setTitle(name)
							.setIcon(icon)
							.onClick(() => notify(runDecision(view, pos, decision))),
					);
				}
			}),
		);

		this.registerMarkdownPostProcessor((el) => renderChanges(el));
	}

	override onunload(): void {}
}
