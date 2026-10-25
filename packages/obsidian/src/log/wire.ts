import { hostname } from "node:os";
import { machineName } from "@md-coeditor/protocol";
import {
	type FileSystemAdapter,
	Notice,
	type Plugin,
	TFile,
	TFolder,
} from "obsidian";
import type { DecisionResult } from "../decide";
import { decisionEvent, renameEvents } from "./events";
import { createLogWriter, type LogWriter, type NewEvent } from "./writer";

export const LOG_FAILED_NOTICE =
	"MD-Coeditor: could not write the event log. See the console.";

export interface EventLog {
	/** Log a decision that was made in the editor of the note at `path`. */
	decided(path: string | undefined, result: DecisionResult): void;
	/** Append any event through the same writer (one queue). Never throws. */
	append(event: NewEvent): void;
}

/** Start the log writer and the rename listener. Never blocks the caller. */
export function startEventLog(plugin: Plugin): EventLog {
	const adapter = plugin.app.vault.adapter as FileSystemAdapter;
	const writer: LogWriter = createLogWriter({
		vault: adapter.getBasePath(),
		machine: machineName(hostname()),
	});
	let warned = false;

	const append = (event: NewEvent): void => {
		writer.append(event).catch((error: unknown) => {
			console.error("MD-Coeditor: event log write failed", error);
			if (!warned) {
				warned = true;
				new Notice(LOG_FAILED_NOTICE);
			}
		});
	};

	plugin.registerEvent(
		plugin.app.vault.on("rename", (file, oldPath) => {
			const kind =
				file instanceof TFolder
					? "folder"
					: file instanceof TFile
						? "file"
						: null;
			if (kind === null) return;
			// A folder gives no event: Obsidian also fires one event for each
			// file below it (task 10.3).
			for (const event of renameEvents({ path: file.path, kind }, oldPath))
				append(event);
		}),
	);

	return {
		append,
		decided(path, result) {
			if (path !== undefined) append(decisionEvent(path, result));
		},
	};
}
