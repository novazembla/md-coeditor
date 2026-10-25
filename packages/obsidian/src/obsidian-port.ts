import type { EditorView } from "@codemirror/view";
import {
	type Editor,
	MarkdownView,
	Notice,
	normalizePath,
	type Plugin,
	TFile,
	type WorkspaceLeaf,
} from "obsidian";
import type { VaultPort } from "./hub/tools";

/** The CodeMirror view of an Obsidian editor (not in the public types). */
function cmView(editor: Editor): EditorView | null {
	return (editor as Editor & { cm?: EditorView }).cm ?? null;
}

const NOTICE_MS = 8000;

/** The real `VaultPort`: Obsidian's workspace and vault. */
export function createObsidianPort(plugin: Plugin): VaultPort {
	const { workspace, vault } = plugin.app;

	/** Markdown views by recency, newest first (D5 fallback, and focus order). */
	let recent: MarkdownView[] = [];
	const remember = (leaf: WorkspaceLeaf | null): void => {
		if (leaf?.view instanceof MarkdownView) {
			const view = leaf.view;
			recent = [view, ...recent.filter((v) => v !== view)];
		}
	};
	remember(workspace.getMostRecentLeaf());
	plugin.registerEvent(workspace.on("active-leaf-change", remember));

	const markdownViews = (): MarkdownView[] => {
		const views: MarkdownView[] = [];
		workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) views.push(leaf.view);
		});
		return views;
	};

	/** Active Markdown view, else the last one that is still open. */
	const activeView = (): MarkdownView | null => {
		const active = workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const open = markdownViews();
		return recent.find((v) => open.includes(v)) ?? null;
	};

	const file = (path: string): TFile => {
		const f = vault.getAbstractFileByPath(normalizePath(path));
		if (!(f instanceof TFile)) throw new Error(`Not a file: ${path}`);
		return f;
	};

	return {
		activeNote: () => activeView()?.file?.path ?? null,

		activeEditor: () => {
			const view = activeView();
			return view ? cmView(view.editor) : null;
		},

		openEditor(path) {
			const views = markdownViews().filter((v) => v.file?.path === path);
			const active = workspace.getActiveViewOfType(MarkdownView);
			recent = recent.filter((v) => markdownViews().includes(v));
			const pick =
				(active && views.includes(active) ? active : undefined) ??
				recent.find((v) => views.includes(v)) ??
				views[0];
			return pick ? cmView(pick.editor) : null;
		},

		process: (path, fn) => vault.process(file(path), fn),
		read: (path) => vault.read(file(path)),

		resolve(path) {
			const f = vault.getAbstractFileByPath(normalizePath(path));
			return f instanceof TFile ? f.path : null;
		},

		notice(text, path) {
			const fragment = document.createDocumentFragment();
			fragment.append(text);
			const notice = new Notice(fragment, NOTICE_MS);
			notice.messageEl.addEventListener("click", () => {
				const f = vault.getAbstractFileByPath(normalizePath(path));
				if (f instanceof TFile) void workspace.getLeaf(false).openFile(f);
				notice.hide();
			});
		},
	};
}
