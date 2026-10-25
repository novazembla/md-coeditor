# coedit-cli Specification

## Purpose

The `coedit` command-line binary is the single entry point for MD-Coeditor on the developer's machine: setup of a vault, start of a co-editor session, the digest for hooks, and the MCP bridge for the agent.

## Requirements

### Requirement: Runs as a command on the PATH
After installation, the `coedit` command SHALL run directly from any folder, without an explicit `node` prefix, on macOS and on Windows.

#### Scenario: Run from another folder on macOS
- **WHEN** the user runs `coedit --version` in a terminal on macOS, in a folder outside the repo
- **THEN** the command runs and exits with code 0

#### Scenario: Run from another folder on Windows
- **WHEN** the user runs `coedit --version` in Command Prompt or PowerShell on Windows, in a folder outside the repo
- **THEN** the command runs and exits with code 0

### Requirement: Show the version
`coedit --version` SHALL write the version of the installed binary to standard output as one line, and exit with code 0. The version SHALL be the same as the version of the package that built the binary.

#### Scenario: Version flag
- **WHEN** the user runs `coedit --version`
- **THEN** standard output contains exactly one line with a semantic version, for example `0.0.0`
- **AND** the exit code is 0

### Requirement: Show help
`coedit --help` SHALL write a usage text to standard output and exit with code 0. The usage text SHALL list each available subcommand with a one-line description. `coedit` without arguments SHALL show the same usage text and exit with code 0.

#### Scenario: Help flag
- **WHEN** the user runs `coedit --help`
- **THEN** standard output contains the word `Usage`
- **AND** the exit code is 0

#### Scenario: No arguments
- **WHEN** the user runs `coedit` with no arguments
- **THEN** standard output contains the same usage text as `coedit --help`
- **AND** the exit code is 0

### Requirement: Reject unknown subcommands
When the first argument is not a known subcommand or option, `coedit` SHALL write an error to standard error that names the unknown argument and tells the user to run `coedit --help`. It SHALL exit with code 2 and write nothing to standard output.

#### Scenario: Unknown subcommand
- **WHEN** the user runs `coedit frobnicate`
- **THEN** standard error contains `frobnicate` and `coedit --help`
- **AND** standard output is empty
- **AND** the exit code is 2

#### Scenario: Unknown option
- **WHEN** the user runs `coedit --frobnicate`
- **THEN** standard error contains `--frobnicate` and `coedit --help`
- **AND** the exit code is 2

### Requirement: The four subcommands
`coedit` SHALL have the subcommands `init`, `claude`, `inbox` and `mcp`. `coedit --help` SHALL list each of them with a one-line description.

#### Scenario: Help lists the subcommands
- **WHEN** the user runs `coedit --help`
- **THEN** standard output has, for each of `init`, `claude`, `inbox` and `mcp`, one line that contains the name and a description

### Requirement: Init finds the vault
`coedit init` SHALL use the nearest folder with an `.obsidian/` folder, starting at the current folder and going up. When there is none, it SHALL write `Not inside an Obsidian vault` to standard error, change nothing, and exit with code 1.

#### Scenario: Run in a subfolder of a vault
- **WHEN** the user runs `coedit init` in `vault/projects/`, and `vault/.obsidian/` exists
- **THEN** `vault/.coedit/` exists after the run

#### Scenario: Not in a vault
- **WHEN** the user runs `coedit init` in a folder with no `.obsidian/` in it or above it
- **THEN** standard error contains `Not inside an Obsidian vault`, no file changes, and the exit code is 1

### Requirement: Init prepares the coedit folder
`coedit init` SHALL write `.coedit/config.json` with default settings only when it is missing. It SHALL make sure that `.coedit/.gitignore` has the lines `local/`, `snapshots/`, `*.sock` and `*.lock`: it SHALL write the file when it is missing, and add only the missing lines when it exists. A second run SHALL keep the user's `config.json` and the user's own `.gitignore` lines as they are. `init` SHALL NOT change notes or the vault's own `.gitignore`.

#### Scenario: First run
- **WHEN** the user runs `coedit init` in a vault with no `.coedit/` folder
- **THEN** `.coedit/config.json` contains `{"digestBudget": 8000}` and `.coedit/.gitignore` contains `local/`

#### Scenario: Second run keeps settings
- **WHEN** `config.json` contains `{"digestBudget": 4000}`, `.coedit/.gitignore` has the user's line `drafts/`, and the user runs `coedit init` again
- **THEN** `config.json` still contains `{"digestBudget": 4000}`
- **AND** `.coedit/.gitignore` still contains `drafts/` and also contains `local/`

### Requirement: Init installs the Obsidian plugin
`coedit init` SHALL copy the Obsidian plugin files to `.obsidian/plugins/md-coeditor/` when they are missing or older, and add `md-coeditor` to `.obsidian/community-plugins.json`. With `--dev`, it SHALL link that folder to the plugin build of the repo instead (a symlink on macOS and Linux, a directory junction on Windows). It SHALL tell the user to reload Obsidian. When it cannot find the plugin files, it SHALL say so, do the other steps, and exit with code 1.

#### Scenario: Plugin copied
- **WHEN** the user runs `coedit init` in a vault without the plugin
- **THEN** `.obsidian/plugins/md-coeditor/main.js` and `manifest.json` exist
- **AND** `.obsidian/community-plugins.json` contains `md-coeditor`
- **AND** standard output contains `Reload Obsidian`

#### Scenario: Dev link
- **WHEN** the user runs `coedit init --dev` in the repo's test vault
- **THEN** `.obsidian/plugins/md-coeditor` is a link to the plugin's build folder

#### Scenario: Plugin files not found
- **WHEN** the user runs `coedit init` with a `coedit` that has no Obsidian plugin files next to it
- **THEN** standard error says that the plugin files were not found
- **AND** `.coedit/config.json` exists, and the exit code is 1

### Requirement: Init reports the Claude plugin
`coedit init` SHALL check if the Claude plugin `md-coeditor` is installed. When it is, `init` SHALL show its id. When it is not installed, `init` SHALL say that `coedit claude` works without an install and show the commands to install it at user scope. `init` SHALL NOT install, enable or disable the Claude plugin. When `claude` is not found, `init` SHALL show a warning and continue.

#### Scenario: Not installed
- **WHEN** `claude` is on the PATH and the plugin is not installed
- **THEN** standard output contains `coedit claude works without an install` and the text `claude plugin install`
- **AND** the Claude settings files do not change

#### Scenario: Claude not found
- **WHEN** `claude` is not on the PATH
- **THEN** standard output contains a warning that `claude` was not found, and the exit code is 0

### Requirement: Init warns about a plugin that is always on
When the Claude plugin is installed and on at user scope, `coedit init` SHALL warn that plain `claude` sessions load the co-editor, and show the command that switches it off.

#### Scenario: Installed and on at user scope
- **WHEN** `claude plugin list --json` shows `md-coeditor@md-coeditor` with scope `user` and enabled
- **THEN** standard output contains `md-coeditor@md-coeditor` and `claude plugin disable md-coeditor@md-coeditor`

### Requirement: Init shows the deny rule
`coedit init` SHALL show a permissions snippet for the project's `.claude/settings.json` that denies direct edits of the vault's Markdown notes, with the vault path relative to the project root (the nearest git root, else the vault). It SHALL show the absolute path of that settings file, and say that the rule applies when `coedit claude` starts in the project root. It SHALL say that the rule does not stop scripts that the agent runs. It SHALL NOT write to any `.claude/` folder.

#### Scenario: Vault in a repo
- **WHEN** the user runs `coedit init` in `repo/notes/`, where `repo/.git/` and `repo/notes/.obsidian/` exist
- **THEN** standard output contains `"deny": ["Edit(/notes/**/*.md)"]` and the absolute path of `repo/.claude/settings.json`
- **AND** `repo/.claude/` does not exist after the run

### Requirement: The launcher finds the vault
`coedit claude` SHALL use, in this order: the `--vault <path>` option; else the nearest folder with `.obsidian/` at or above the current folder; else the one vault found in the folders below the current folder (up to 3 levels, not in hidden folders or `node_modules`). With no vault, or with more than one vault below, it SHALL list what it found, ask for `--vault`, and exit with code 1. A `--vault` path without `.obsidian/` SHALL be refused with exit code 1.

#### Scenario: Vault below the repo
- **WHEN** the user runs `coedit claude` in `repo/`, and the only vault is `repo/docs/vault/`
- **THEN** the session uses `repo/docs/vault/` as the vault and runs in `repo/`

#### Scenario: Two vaults below
- **WHEN** the user runs `coedit claude` in a folder with the vaults `a/` and `b/` below it
- **THEN** standard error lists `a` and `b` and contains `--vault`, and the exit code is 1

#### Scenario: Vault option is not a vault
- **WHEN** the user runs `coedit claude --vault docs/` and `docs/.obsidian/` does not exist
- **THEN** standard error contains `docs` and `not an Obsidian vault`, and the exit code is 1

### Requirement: The launcher switches the plugin on for one session
`coedit claude` SHALL start `claude` in the current folder with `--settings <file>`, where the file is new and temporary and holds `enabledPlugins` with the plugin id set to true. It SHALL use the installed plugin's id when the plugin is installed, else `--plugin-dir` with the plugin that comes with `coedit` and the id `md-coeditor@inline`. It SHALL delete the file and its temporary folder after `claude` exits, and SHALL NOT change any Claude settings file.

#### Scenario: Plugin installed from the marketplace
- **WHEN** the plugin is installed as `md-coeditor@md-coeditor` and the user runs `coedit claude`
- **THEN** `claude` starts with `--settings` and a file whose `enabledPlugins` is `{"md-coeditor@md-coeditor": true}`, and without `--plugin-dir`

#### Scenario: Plugin not installed
- **WHEN** the plugin is not installed and the user runs `coedit claude`
- **THEN** `claude` starts with `--plugin-dir <bundled plugin>` and a settings file whose `enabledPlugins` is `{"md-coeditor@inline": true}`

#### Scenario: Settings file removed
- **WHEN** the `claude` session ends
- **THEN** the temporary settings file and its folder no longer exist

### Requirement: The launcher passes the session values
The `env` of the temporary settings file SHALL hold `COEDIT_VAULT` set to the absolute vault path, `COEDIT_SESSION` set to a new random session id, and `COEDIT_NODE` set to the path of the Node program that runs the launcher.

#### Scenario: A new session id for each run
- **WHEN** the user runs `coedit claude` two times in `repo/` with the vault `repo/notes/`
- **THEN** both settings files have `COEDIT_VAULT` set to the absolute path of `repo/notes/`
- **AND** the two settings files have different `COEDIT_SESSION` values

### Requirement: The launcher survives Ctrl+C
While `claude` runs, the launcher SHALL NOT stop or delete the settings file on `SIGINT`. It SHALL pass `SIGTERM` and `SIGHUP` on to `claude`. At start, it SHALL delete temporary settings folders of earlier runs that are older than one day.

#### Scenario: Ctrl+C during an agent turn
- **WHEN** the user presses Ctrl+C in a session that `coedit claude` started
- **THEN** the launcher keeps running, and the temporary settings file still exists

#### Scenario: Left-over folder
- **WHEN** a `coedit-` settings folder from two days ago is in the temp folder, and the user runs `coedit claude`
- **THEN** that folder no longer exists

### Requirement: The launcher starts an agent profile on request
`coedit claude --agent [name]` SHALL pass `--agent <name>` to `claude`. Without a name, the name SHALL be `md-coeditor:co-editor`. Without `--agent`, the launcher SHALL NOT pass `--agent`.

#### Scenario: Shipped profile
- **WHEN** the user runs `coedit claude --agent`
- **THEN** `claude` starts with `--agent md-coeditor:co-editor`

#### Scenario: Own profile
- **WHEN** the user runs `coedit claude --agent my-editor`
- **THEN** `claude` starts with `--agent my-editor`

### Requirement: The launcher passes other arguments through
Arguments after `--` SHALL go to `claude` unchanged, after the launcher's own arguments. `coedit claude` SHALL exit with the exit code of `claude`. When `claude` is not found, it SHALL say so and exit with code 1.

#### Scenario: Pass a model
- **WHEN** the user runs `coedit claude -- --model sonnet`
- **THEN** `claude` gets `--model sonnet`

#### Scenario: Claude missing
- **WHEN** `claude` is not on the PATH
- **THEN** standard error contains `claude` and `not found`, and the exit code is 1

### Requirement: The launcher starts claude on Windows without a shell
On Windows, `coedit claude` SHALL start `claude.exe` when it is found, else the target of the npm shim `claude.cmd`. It SHALL NOT start `claude` through cmd.exe. Each argument, also with spaces, `%`, `^` or `!`, SHALL reach `claude` unchanged. When the shim has no target that the launcher can read, it SHALL say that the native `claude.exe` is needed and exit with code 1.

#### Scenario: npm install on Windows
- **WHEN** only `claude.cmd` is on the PATH and the vault path is `C:\Users\A B\vault`
- **THEN** `claude` starts and its session has `COEDIT_VAULT` set to `C:\Users\A B\vault`

#### Scenario: Percent sign in an argument
- **WHEN** the user runs `coedit claude -- --append-system-prompt "make it 50% shorter"` on Windows
- **THEN** `claude` gets the argument `make it 50% shorter` unchanged

### Requirement: Bridge and hook find the vault
`coedit mcp` and `coedit inbox` SHALL use the vault in `COEDIT_VAULT`. When it is not set, empty, or the literal text `${COEDIT_VAULT}`, they SHALL find the vault like the launcher: at or above the current folder, else the one vault below it. They SHALL read only the machine folder of their own machine, and SHALL treat an `endpoint.json` whose `host` is another machine as no endpoint.

#### Scenario: Variable set by the launcher
- **WHEN** `COEDIT_VAULT` is `/work/repo/notes`, `coedit mcp` runs in `/work/repo` on the machine `work-mac`
- **THEN** the bridge reads `/work/repo/notes/.coedit/local/work-mac/endpoint.json`

#### Scenario: Unexpanded variable
- **WHEN** `COEDIT_VAULT` is the text `${COEDIT_VAULT}` and `coedit inbox` runs inside a vault
- **THEN** it uses that vault

#### Scenario: Vault below without the variable
- **WHEN** `COEDIT_VAULT` is empty, `coedit mcp` runs in `repo/`, and the only vault is `repo/docs/vault/`
- **THEN** the bridge uses `repo/docs/vault/`

#### Scenario: Endpoint of another machine
- **WHEN** the endpoint file in the bridge's machine folder has the `host` `home-pc`, and the bridge runs on `work-mac`
- **THEN** `get_context` returns `hubConnected: false`
