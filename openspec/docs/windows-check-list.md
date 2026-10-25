# Windows check list

There is no Windows machine for now. This list holds the checks that need one. Do them when a Windows machine is available, then record the results in [roadmap.md](roadmap.md) (Open checks) and remove the done items here.

Status: **not done**. Tasks that depend on this list are marked "provisional" in their change.

## Setup

- [ ] Windows 10 or 11, Node 24.15 or newer, pnpm 12, Git, Obsidian, Claude Code with a login.
- [ ] Clone the repo, `pnpm install`, `pnpm build`, `pnpm check`. All tests pass (the bundle stale check too: the source hash ignores `\r\n`).
- [ ] `pnpm link:bin`, then `coedit --version` and `coedit --help` work in a new terminal (PowerShell and cmd.exe).

## From earlier changes

- [ ] Change 2 (`add-obsidian-review-basics`, task 11.6): the review basics work in Obsidian on Windows (manual list in [testing.md](testing.md)).
- [ ] Change 12 (`add-obsidian-e2e-tests`): `pnpm test:e2e` runs and passes on Windows (`modKey()` is Ctrl).

## Change 3 (`add-claude-suggest-loop`, task 12.6)

### `coedit init`

- [ ] `coedit init --dev` in `test-vault/` makes a directory junction `.obsidian/plugins/md-coeditor` → `packages/obsidian/dist`, with no admin rights. Obsidian loads the plugin.
- [ ] A second `coedit init --dev` says "already linked" and changes nothing.
- [ ] `coedit init` in a vault with a path with spaces (for example `C:\Users\A B\vault`) copies the plugin and writes `.coedit/`.
- [ ] The deny rule text shows the right path (`/` separators in the rule, the absolute path of `.claude\settings.json`).

### Hub in Obsidian

- [ ] After the plugin loads, `.coedit\local\<machine>\endpoint.json` exists, with the machine name as `host`.
- [ ] With the vault in a synced folder (OneDrive or Dropbox), a reload of the plugin writes `endpoint.json` again without an error (rename retry on `EPERM` or `EBUSY`).
- [ ] Switch the plugin off: `endpoint.json` is deleted.

### `coedit claude`

- [ ] Native install (`claude.exe` on the PATH): `coedit claude` starts a session. The five tools are there (`/mcp`).
- [ ] npm install (only `claude.cmd` on the PATH): `coedit claude` starts the target of the shim without cmd.exe, and the session works.
- [ ] Vault path with spaces: the session has `COEDIT_VAULT` set to the full path (ask the agent to call `get_context`, or check the digest).
- [ ] `coedit claude -- --append-system-prompt "make it 50% shorter"`: the argument arrives unchanged (also try `^` and `!`).
- [ ] Ctrl+C during an agent turn: the session goes on, and the temp settings folder `%TEMP%\coedit-*` still exists.
- [ ] After the session ends, the temp settings folder is gone.
- [ ] Close the console window during a session. The next `coedit claude` (after one day, or with an old folder made by hand) removes the left-over `coedit-*` folder.

### The loop

- [ ] Suggest a change through the agent: it shows in Obsidian. Accept one change, reject one, type a prompt: the digest lists both.
- [ ] A note with `\r\n` line ends: `read_note` returns no `\r`, and `suggest_edit` works in it.
