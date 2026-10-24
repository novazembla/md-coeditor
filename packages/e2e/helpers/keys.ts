import { Key } from "webdriverio";

/** The Cmd key on macOS, the Ctrl key on Windows and Linux. Tests never use Meta or Control directly. */
export function modKey(): string {
	return process.platform === "darwin" ? Key.Command : Key.Control;
}
