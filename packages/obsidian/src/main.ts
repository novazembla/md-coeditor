import type { EditorView } from "@codemirror/view";
import type { Decision } from "@md-coeditor/format";
import { type Editor, editorLivePreviewField, Notice, Plugin } from "obsidian";
import { applyDecision, menuPos } from "./decide";
import { coeditExtension } from "./extension";
import { createHubRuntime, type ManagedHub } from "./hub/start";
import { type EventLog, startEventLog } from "./log/wire";
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

/** Decide, show the notice if nothing was decided, else log the decision. */
function decideAndLog(
	log: EventLog,
	view: EditorView,
	pos: number,
	decision: Decision,
	path: string | undefined,
): void {
	const outcome = applyDecision(view, pos, decision);
	if ("notice" in outcome) notify(outcome.notice);
	else log.decided(path, outcome.result);
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
	private hub: ManagedHub | null = null;

	override async onload(): Promise<void> {
		const log = startEventLog(this);
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
				editorCheckCallback: (checking, editor, ctx) => {
					const view = cmView(editor);
					if (!isLivePreview(view.state)) return false;
					if (!checking)
						decideAndLog(
							log,
							view,
							view.state.selection.main.head,
							decision,
							ctx.file?.path,
						);
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
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const view = cmView(editor);
				if (!isLivePreview(view.state)) return;
				const pos = menuPos(view.state);
				if (pos === null) return;
				for (const { name, icon, decision } of DECISIONS) {
					menu.addItem((item) =>
						item
							.setTitle(name)
							.setIcon(icon)
							.onClick(() =>
								decideAndLog(log, view, pos, decision, info.file?.path),
							),
					);
				}
			}),
		);

		this.registerMarkdownPostProcessor((el) => renderChanges(el));
		this.hub = createHubRuntime(this, log);
		await this.hub.start();
	}

	override async onunload(): Promise<void> {
		await this.hub?.stop();
		this.hub = null;
	}
}
