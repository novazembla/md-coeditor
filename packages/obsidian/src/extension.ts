import type { EditorState, Extension } from "@codemirror/state";
import { menuPosField, menuPosHandler } from "./decide";
import { livePreviewCheck, marksField } from "./marks";
import { motionKeymap } from "./motion";
import { protectFilter, protectKeymap } from "./protect";
import { renderField } from "./render";

export interface CoeditOptions {
	/** True when the editor is in Live Preview (Obsidian: `editorLivePreviewField`). */
	isLivePreview: (state: EditorState) => boolean;
}

/** All MD-Coeditor editor parts as one CodeMirror extension. */
export function coeditExtension(options: CoeditOptions): Extension {
	return [
		livePreviewCheck.of(options.isLivePreview),
		marksField,
		renderField,
		protectFilter,
		protectKeymap,
		motionKeymap,
		menuPosField,
		menuPosHandler,
	];
}
