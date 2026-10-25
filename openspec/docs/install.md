# Install (development)

Status: all steps work after the change `add-claude-suggest-loop`, except the checks with a real `claude` login (tasks 12.3 to 12.5 of that change). Windows is not tested yet: see [windows-check-list.md](windows-check-list.md).

| Step | Command |
|---|---|
| 1. Get the code and build | `pnpm install`, `pnpm build` |
| 2. Put `coedit` on your PATH | `pnpm link:bin` |
| Test vault | `coedit init --dev` in `test-vault/` |
| 3. Prepare a vault | `coedit init` |
| 4. Start a session | `coedit claude` |
| 5. Optional: install the Claude plugin from the marketplace | `claude plugin install` |

The build makes one JavaScript file, `coedit.mjs`. `pnpm link:bin` puts an entry for that file on your PATH as `coedit`. For the npm package (later), see [tech-stack.md](tech-stack.md#distribution-planned).

## Requirements

- macOS or Windows (desktop only). Linux should work, but it is not a test target.
- Node 24.15 or newer
- pnpm 12. Run `corepack enable`, or install pnpm yourself.
- Obsidian (desktop app)
- Claude Code, with a login (only for `coedit claude`)

The commands in steps 1 and 2 are written for the macOS Terminal and Windows PowerShell. Windows is not tested yet: see [windows-check-list.md](windows-check-list.md).

## 1. Get the code and build

```sh
git clone https://github.com/novazembla/md-coeditor.git
cd md-coeditor
pnpm install
pnpm build
```

`pnpm build` writes:

- `packages/obsidian/dist/`: the Obsidian plugin
- `packages/bridge/dist/coedit.mjs`: the `coedit` binary
- `adapters/claude/dist/coedit.mjs`: a copy for the Claude plugin

To check the build, run `pnpm check` (lint, type check and tests).

## 2. Put `coedit` on your PATH

Do this one time, in the repo folder:

```sh
pnpm link:bin
coedit --version
```

`pnpm link:bin` puts an entry in a bin folder:

| OS | Bin folder | Entry |
|---|---|---|
| macOS, Linux | `~/.local/bin` | Symlink `coedit` → `packages/bridge/dist/coedit.mjs` |
| Windows | `%LOCALAPPDATA%\md-coeditor\bin` | File `coedit.cmd` that runs `node` with the full path to `coedit.mjs` |

- The entry points to the build output. After a new `pnpm build`, you do not have to link again.
- If the bin folder is not on your PATH, the script shows a warning and the instruction for your OS. Do the instruction, open a new terminal, and run `coedit --version` again.
- To use a different folder, set the environment variable `COEDIT_BIN_DIR` before you run `pnpm link:bin`.
- To remove the entry, run `pnpm link:bin --remove`.

Alternative (not verified): `pnpm add -g ./packages/bridge`. pnpm can copy the package instead of linking it. Then you must run it again after each build.

## Test vault (development)

The repo contains `test-vault/`, a small Obsidian vault for manual tests. To link the plugin build into it:

```sh
cd test-vault
coedit init --dev
```

On macOS and Linux this makes a relative symlink, on Windows a directory junction: `test-vault/.obsidian/plugins/md-coeditor` → `packages/obsidian/dist`. It also prepares `.coedit/` (step 3). Then open `test-vault/` in Obsidian as a vault. If restricted mode is on, turn it off.

## 3. Prepare a vault

```sh
cd /path/to/your/vault          # a folder in the vault also works
coedit init                     # in the repo: coedit init --dev
```

`coedit init` does these steps. You can run it again with no damage.

1. It finds the vault: the nearest folder with `.obsidian/`, from this folder upward. If there is none, it stops with `Not inside an Obsidian vault` and exit code 1.
2. It installs the Obsidian plugin. With `--dev`, it links `packages/obsidian/dist` (a symlink, on Windows a junction). Without `--dev`, it copies `main.js`, `manifest.json` and `styles.css`. It needs the repo build for this, so run `pnpm build` first.
3. It creates `.coedit/` with `config.json` and `.coedit/.gitignore`. It keeps your own lines in both files.
4. It reports the Claude plugin (`claude plugin list --json`). If the plugin is not installed, it shows the commands of step 5. It does not install it. If the plugin is on at user scope, it warns and shows `claude plugin disable <id>`.
5. It shows the deny rule (see below). It does not write it.

Then reload Obsidian. If restricted mode is on, turn it off. If the plugin is off, switch it on: **Settings → Community plugins → MD-Coeditor**.

### Deny rule (optional)

The agent only suggests changes. This is a soft rule: the tool descriptions, the server instructions and the optional profile (`--agent`) say so. A hard block comes from the project's Claude Code permissions and from the sandbox. `coedit init` shows a rule for this, for example:

```json
{
  "permissions": {
    "deny": ["Edit(/test-vault/**/*.md)"]
  }
}
```

Add it to `.claude/settings.json` in the project root. The project root is the nearest folder with `.git` at or above the vault. If there is none, it is the vault. The path in the rule is relative to that root. The rule applies when `coedit claude` starts in that root.

Limits:

- One `Edit` rule also covers Write, MultiEdit and NotebookEdit.
- A deny rule does not stop a script that the agent runs (for example `sed -i` in a shell command). For a hard block, use the Claude Code sandbox.
- `coedit init` never writes this file. You add the rule.

## 4. Start a session

```sh
cd /path/to/repo                 # the vault is here, above, or below (up to 3 levels)
coedit claude
```

This starts Claude Code with the MD-Coeditor plugin for this session only. Other `claude` sessions do not load it. Obsidian must be open with the plugin on.

| Option | Meaning |
|---|---|
| `--vault <path>` | Use this vault. Without it, `coedit claude` takes the nearest vault at or above the current folder, else the one vault below it. With none or with more than one, it lists what it found and asks for `--vault`. A path without `.obsidian/` is refused (exit code 1). |
| `--agent [name]` | Start an agent profile. Without a name: `md-coeditor:co-editor` (reads notes, suggests changes, has no Edit, Write or Bash tool). |
| `-- <arguments>` | Everything after `--` goes to `claude` unchanged, for example `coedit claude -- --continue`. |

`coedit claude` runs in the current folder, not in the vault. It makes a temporary settings file and passes it with `claude --settings <file>`. The file switches the plugin on for this session and names the vault and the session. `coedit claude` deletes the file when `claude` ends. If the Claude plugin is not installed, it loads the plugin from the repo with `--plugin-dir`.

## 5. Optional: install the Claude plugin from the marketplace

You do not need this step. Without it, `coedit claude` loads the plugin from the repo (`--plugin-dir`). Install it if your company does not allow `--plugin-dir`, or if you want to see the plugin in `/plugin`.

```sh
claude plugin marketplace add /path/to/md-coeditor
claude plugin install md-coeditor@md-coeditor --scope user
claude plugin list
```

The plugin has `defaultEnabled: false`. If `claude plugin list` shows it as enabled, switch it off:

```sh
claude plugin disable md-coeditor@md-coeditor
```

`coedit claude` switches it on for its own sessions only. Whether `claude plugin install` switches the plugin on at user scope is a manual check (task 12.3 of the change). `coedit init` warns when it is on.

Do not install it at project scope. Then every `claude` session in the vault loads it, also sessions for other work.
