type Env = Record<string, string | undefined>;

/** Unset, empty, or an unexpanded `${NAME}` counts as not set. */
function read(env: Env, name: string): string | undefined {
	const value = env[name];
	if (value === undefined || value === "" || value === `\${${name}}`) {
		return undefined;
	}
	return value;
}

/** Bridge session: COEDIT_SESSION, else CLAUDE_CODE_SESSION_ID, else "default". */
export function bridgeSession(env: Env): string {
	return (
		read(env, "COEDIT_SESSION") ??
		read(env, "CLAUDE_CODE_SESSION_ID") ??
		"default"
	);
}

/**
 * Hook session: `--session` option, else COEDIT_SESSION, else the hook input
 * `session_id`. Returns undefined when none is set.
 */
export function hookSession(
	option: string | undefined,
	env: Env,
	hookInput: { session_id?: unknown } | undefined,
): string | undefined {
	if (option !== undefined && option !== "") return option;
	const fromEnv = read(env, "COEDIT_SESSION");
	if (fromEnv !== undefined) return fromEnv;
	const id = hookInput?.session_id;
	return typeof id === "string" && id !== "" ? id : undefined;
}
