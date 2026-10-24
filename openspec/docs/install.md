# Install (development)

Status: steps 1 and 2 work after the change `setup-monorepo`. Steps 3, 4 and 5 come with slice 1 (`coedit init`, `coedit claude`, the Claude plugin with hooks and MCP config).

| Step | Works after |
|---|---|
| 1. Get the code and build | `setup-monorepo` |
| 2. Put `coedit` on your PATH | `setup-monorepo` (only `coedit --version` and `coedit --help`) |
| Test vault: `pnpm link:vault` | `setup-monorepo` (temporary, until `coedit init --dev`) |
| 3. Prepare a vault (`coedit init`) | slice 1 |
| 4. Start a session (`coedit claude`) | slice 1 |
| 5. Install the Claude plugin from the marketplace | slice 1 |

The build makes one JavaScript file, `coedit.mjs`. `pnpm link:bin` puts an entry for that file on your PATH as `coedit`. For the npm package (later), see [tech-stack.md](tech-stack.md#distribution-planned).

## Requirements

- macOS or Windows (desktop only). Linux should work, but it is not a test target.
- Node 24.15 or newer
- pnpm 12. Run `corepack enable`, or install pnpm yourself.
- Obsidian (desktop app)
- Claude Code (slice 1)

The commands in steps 1 and 2 work in the macOS Terminal and in Windows PowerShell.

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
pnpm link:vault
```

On macOS and Linux this makes a symlink, on Windows a directory junction: `test-vault/.obsidian/plugins/md-coeditor` → `packages/obsidian/dist`. Then open `test-vault/` in Obsidian as a vault. If restricted mode is on, turn it off.

This script is temporary. In slice 1, `coedit init --dev` (step 3) replaces it.

## 3. Prepare a vault (slice 1)

```sh
cd /path/to/your/vault          # or: cd test-vault
coedit init --dev
```

`coedit init` does these steps. You can run it again with no damage.

1. It finds the vault: it looks for `.obsidian/` in this folder and in the folders above it.
2. It installs the Obsidian plugin. With `--dev`, it makes a link to `packages/obsidian/dist`. Without `--dev`, it copies the files.
3. It checks whether the Claude plugin is installed. If not, it shows the commands for step 5. It does not install it for you.
4. It creates `.coedit/` with `config.json` and `.coedit/.gitignore`.

Then reload Obsidian. If restricted mode is on, turn it off. If the plugin is off, switch it on: **Settings → Community plugins → MD-Coeditor**.

## 4. Start a session (slice 1)

```sh
coedit claude --doc note.md
```

This starts Claude Code with the MD-Coeditor plugin for this session only. Other `claude` sessions do not load it.

## 5. Optional: install the Claude plugin from the marketplace (slice 1)

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

`coedit claude` switches it on for its own sessions only.

Do not install it at project scope. Then every `claude` session in the vault loads it, also sessions for other work.
