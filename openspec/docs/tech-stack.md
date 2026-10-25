# Tech stack

Status: accepted on 2026-10-24. The change `setup-monorepo` sets it up.

Systems: desktop only, macOS and Windows. Linux should work, but it is not a test target.

Scope: Claude Code only. Codex is deferred, because we have no access to it. The design stays agent-neutral, so we can add Codex later.

## Summary

| Area | Choice | Why |
|---|---|---|
| Monorepo | pnpm 12 workspaces, with a `catalog:` for shared versions. No Turborepo, no Nx. | Four packages do not need a build orchestrator. `pnpm -r` and `--filter` are enough. The catalog keeps versions the same in all packages. |
| Language | TypeScript, strict, ESM | The same language in Obsidian, the bridge and the tests. |
| Runtime | Node `>=24.15` for development (jsdom 30 needs it). Node `>=24` for the `coedit` runtime. | Obsidian runs in Electron, which is also Node. One runtime, no Bun. |
| Build | esbuild for the bundles. `tsc --noEmit` for type checks. | The official Obsidian sample plugin uses esbuild. One fast tool for all bundles. |
| Shared code | Internal packages that export TypeScript source | No build step for `format` and `protocol`. esbuild and vitest read the source directly. |
| MCP | `@modelcontextprotocol/sdk`, stdio transport | Claude Code starts the bridge as a subprocess. Channels (push) need stdio. |
| Hub ⇄ bridge | WebSocket. `ws` in the plugin (server). Node's built-in `WebSocket` in the bridge (client). | Node has no built-in WebSocket server, so the plugin needs `ws`. The bridge needs no extra package (it only needs Node 24, which has a global `WebSocket`). `ws` is also a devDependency of the bridge, for the fake hubs in its tests. |
| Schemas | zod, in `packages/protocol` | One contract for both ends. The MCP SDK also uses zod. |
| CLI arguments | `node:util` `parseArgs` | No package needed for a few subcommands. |
| Tests | vitest. jsdom for the CodeMirror 6 tests. `fast-check` (^4.10.2, in the catalog) for property tests in `packages/format`. | Fast, TypeScript without a build. Property tests find edge cases of the parser (round trip) that example tests miss. |
| End-to-end tests | WebdriverIO 9 + mocha + `wdio-obsidian-service`, in `packages/e2e`. See [testing.md](testing.md). | jsdom has no layout and no Obsidian. The service runs a pinned Obsidian version with the plugin build. wdio does not support vitest, so the e2e tests use mocha. |
| Lint and format | Biome | One tool instead of ESLint + Prettier. Add `eslint-plugin-obsidianmd` only if we publish to the Obsidian community store. |

## Repo layout

```
md-coeditor/
├── package.json              # private root, scripts only; packageManager pnpm@12.15.0
├── pnpm-workspace.yaml       # packages/*, adapters/*, spikes/*; catalog: shared versions
├── tsconfig.base.json
├── biome.json
├── .claude-plugin/
│   └── marketplace.json      # local marketplace: lists adapters/claude
├── packages/
│   ├── format/               # @md-coeditor/format
│   ├── protocol/             # @md-coeditor/protocol
│   ├── obsidian/             # Obsidian plugin
│   ├── bridge/               # @md-coeditor/bridge → binary "coedit"
│   └── e2e/                  # @md-coeditor/e2e: end-to-end tests in the real Obsidian app
├── adapters/
│   └── claude/               # Claude Code plugin
├── spikes/                   # S1, S2. Throwaway. Delete when done.
├── test-vault/               # Obsidian test vault for manual tests
├── scripts/                  # Node helper scripts (link:bin, e2e-docker)
└── openspec/
```

## Packages

| Package | Contents | Depends on |
|---|---|---|
| `packages/format` | CriticMarkup dialect: parse, serialize, edit ops, accept, reject, rebase, protected zones. Pure functions. No Obsidian, no CodeMirror. | nothing |
| `packages/protocol` | Hub ⇄ bridge messages. Log event types (envelope `{v, seq, type, ts, note, session, agent, …}`). zod schemas. | `format` (types only) |
| `packages/obsidian` | Obsidian plugin: CodeMirror 6 extension, commands, hub, log writer. | `format`, `protocol` |
| `packages/bridge` | The `coedit` binary: subcommands `mcp`, `inbox`, `claude`, `init`. | `format`, `protocol` |
| `adapters/claude` | Claude Code plugin: manifest, MCP config, hooks, agent definition. | the `coedit` bundle |
| `packages/e2e` | End-to-end tests: wdio config, helpers, fixture vault, `tests/*.e2e.ts`. No `exports`, no build. | the plugin build in `packages/obsidian/dist` |

### Internal packages

- Each internal package has `"private": true` and `"exports": { ".": "./src/index.ts" }`.
- Internal packages have no build step. The bundles (plugin, bridge) and vitest compile them.
- `tsconfig.base.json` uses `"moduleResolution": "bundler"` and `"verbatimModuleSyntax": true`.

### Versions and tool settings

- **One place for versions.** Shared tools are root devDependencies. Package-specific versions are in the `catalog:` in `pnpm-workspace.yaml`. Do not write a version into a package's `package.json`.
- **CodeMirror versions.** The catalog pins `@codemirror/state` and `@codemirror/view` to the exact versions that the `obsidian` package declares as peers. When you update `obsidian`, check them again.
- **pnpm 12 settings** in `pnpm-workspace.yaml`:
  - `allowBuilds`: `esbuild: true` and `classic-level: true` (needed by `wdio-obsidian-service`); `edgedriver: false` and `geckodriver: false` (browser drivers that the e2e tests do not use). pnpm 12 blocks install scripts by default.
  - `minimumReleaseAgeExclude` lists `@biomejs/biome` and its `@biomejs/cli-*` platform packages with exact versions. When you update Biome, update or remove these entries.
- **TypeScript 7** (native compiler). If the `obsidian` types or other types fail with it, fall back to `typescript@6`. Only the type check uses `tsc`.
- **Node.** `.node-version` is `24`. The ranges also accept Node 26. A later change moves the development default to 26.
- **Biome does not check Markdown.** Biome 2.6 formats Markdown and changes content (for example `@codemirror/*` becomes `@codemirror/_`). So `biome.json` ignores `**/*.md`.

## Builds

| Output | Tool and settings | Notes |
|---|---|---|
| `packages/obsidian/dist/main.js`, `manifest.json`, `styles.css` | esbuild, `format: "cjs"`, target `es2022`. External: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`. | Obsidian loads CommonJS. The plugin must use Obsidian's CodeMirror, so we do not bundle it. `ws` is bundled. |
| `packages/bridge/dist/coedit.mjs` | esbuild, `platform: "node"`, `format: "esm"`, banner `#!/usr/bin/env node` and a `createRequire` line. All dependencies are in the file. On macOS and Linux, the build script sets the executable bit (with `fs.chmod`). | One file starts fast. The hook runs it on each prompt. The `.mjs` extension makes Node load the file as ESM in all locations, also in a plugin cache. |
| `adapters/claude/dist/coedit.mjs` | A copy of the bridge bundle | The Claude plugin must be self-contained (see below). |

`dist/` folders are build output. Git ignores them.

### Root scripts

| Script | What it does |
|---|---|
| `pnpm build` | Builds all packages (`pnpm -r build`). |
| `pnpm dev` | Runs all builds in watch mode. |
| `pnpm test` | Runs all vitest tests. Not the e2e tests. |
| `pnpm test:e2e` | Builds the plugin, then runs the end-to-end tests in Obsidian on this machine. Not in `pnpm check`: slow, needs a display, and takes the desktop focus. See [testing.md](testing.md). |
| `pnpm test:e2e:docker` | Runs the end-to-end tests in Linux in Docker with a virtual display (no window). Needs Docker. See [testing.md](testing.md). |
| `pnpm typecheck` | Runs `tsc --noEmit` in each package. |
| `pnpm lint` | Runs `biome check .`. |
| `pnpm format` | Runs `biome check --write .`. |
| `pnpm check` | Runs lint, typecheck and test. |
| `pnpm link:bin` | Puts `coedit` on the PATH (see [install.md](install.md)). Temporary. |

The test vault has no root script: use `coedit init --dev` in `test-vault/` (the old `pnpm link:vault` is gone).

### macOS and Windows

- Scripts are Node scripts (`.mjs`). No shell commands (`rm -rf`, `cp`, `chmod`, `ln`) in `package.json` scripts.
- Code uses `node:path` to join paths.
- `.gitattributes` sets LF line endings on all systems.
- The Claude plugin and the tests start `coedit.mjs` with `node`. They do not use the shebang or the PATH. Windows ignores the shebang.
- Windows is not tested yet. The open checks are in [windows-check-list.md](windows-check-list.md).

## Obsidian plugin

- `manifest.json` has `"isDesktopOnly": true`. The plugin uses Node APIs: `ws` (bundled, for the hub), `node:crypto` (token), `node:fs` and `node:os` (endpoint file, machine folder). Node's global `WebSocket` has no server side, and a client without an `Origin` header (the bridge) connects with the token only.
- `minAppVersion` must not be higher than the Obsidian app on the developer's machine. Use the lower of the installed app version and the `obsidian` types version.
- The CodeMirror 6 tests use the same `@codemirror/*` versions as Obsidian. They are devDependencies only.
- `@codemirror/commands` is a devDependency for tests only (history and undo, cursor commands). Plugin code never imports it, because Obsidian does not provide it at runtime.
- The Live Preview logic is plain CodeMirror 6 code. It gets `isLivePreview` as an injected function. `main.ts` passes Obsidian's `editorLivePreviewField`. The reason: the `obsidian` package has no runtime code, so vitest cannot run code that imports it.
- Development loop: esbuild in watch mode, and the "Hot Reload" community plugin in the test vault. `coedit init --dev` links the plugin folder to `packages/obsidian/dist`.

## Claude Code plugin

```
adapters/claude/
├── .claude-plugin/plugin.json   # name "md-coeditor", defaultEnabled: false (no settings.agent)
├── .mcp.json                    # ${COEDIT_NODE:-node} "${CLAUDE_PLUGIN_ROOT}/dist/coedit.mjs" mcp; env COEDIT_VAULT, COEDIT_SESSION
├── hooks/hooks.json             # UserPromptSubmit → node …/coedit.mjs inbox --digest --mark-read (timeout 10)
├── agents/co-editor.md          # optional profile, started with coedit claude --agent
└── dist/coedit.mjs              # build output
```

There is no guard hook (no `PreToolUse`) and no `settings.agent`: the normal Claude Code agent runs unless the user starts the profile.

- **Self-contained.** When Claude Code installs a plugin from a marketplace, it copies only the plugin folder. Files outside the folder are not available. So the bridge bundle goes into `dist/` inside the plugin.
- **Soft protection.** The agent is suggest-only by the tool descriptions, the server instructions and the optional profile (no Edit, Write or Bash tool). Hard blocks come from the project's Claude Code permissions (the deny rule that `coedit init` shows) and from the sandbox. A deny rule does not stop a script that the agent runs.
- **No `bin/` folder.** Claude Code puts a plugin's `bin/` on the PATH of the Bash tool. The agent could then run `coedit inbox --mark-read` itself and move the cursor.
- **`defaultEnabled: false`.** The plugin never switches on by itself, at any scope.
- **No `version` field** in `plugin.json`. A fixed version pins marketplace installs. The validator warning "No version specified" is expected.

### How a session loads the plugin

`coedit claude` starts Claude Code and switches on the plugin for this session only. It writes a temporary settings file (`<tmp>/coedit-*/settings.json`) and passes `--settings <file>`. The flag has the scope "this session only". The launcher never uses inline JSON: the quoting is not safe on Windows. It deletes the file when `claude` ends.

```json
{
  "enabledPlugins": { "<id>": true },
  "env": { "COEDIT_VAULT": "<vault>", "COEDIT_SESSION": "<uuid>", "COEDIT_NODE": "<node path>" }
}
```

| Case | Command that the launcher runs |
|---|---|
| The plugin is installed (`claude plugin list --json`, id `md-coeditor@…`) | `claude --settings <file>` with `<id>` = `md-coeditor@md-coeditor` |
| The plugin is not installed | `claude --settings <file> --plugin-dir <bundled plugin>` with `<id>` = `md-coeditor@inline` |

- Arguments: `--vault <path>`, `--agent [name]`, then `--` and the arguments for `claude`. The order for `claude` is `--settings`, `--plugin-dir`, `--agent`, then the pass-through arguments.
- The MCP server and the hook read `env` from the settings file. `.mcp.json` names the variables again, so they also arrive with `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1`.
- The bundled plugin folder: `COEDIT_PLUGIN_DIR`, else the parent of the running `coedit.mjs` (the plugin's own copy), else the repo layout `adapters/claude`.
- While `claude` runs, the launcher ignores Ctrl+C (`SIGINT`): it must only stop the agent's turn.
- On Windows, `claude` can be `claude.exe` (native installer) or `claude.cmd` (npm). The launcher starts `.exe` directly, and starts the target of a `.cmd` shim with Node, never through a shell. Not tested yet: see [windows-check-list.md](windows-check-list.md).

Later, for push, the launcher also adds `--dangerously-load-development-channels plugin:<id>` (spike S2).

### Corporate setting

An administrator can limit Claude Code with managed settings. These settings can affect MD-Coeditor:

| Managed setting | Effect on MD-Coeditor | What to do |
|---|---|---|
| `--plugin-dir` turned off | The fallback without install does not work. | Install the plugin from a marketplace that the company allows. |
| `strictKnownMarketplaces`, `blockedMarketplaces` | You can add only allowed marketplaces. | The company adds MD-Coeditor to its internal marketplace (for example with an npm source). |
| `allowManagedHooksOnly` | Our hooks do not run. The digest stops. | The administrator must deploy the hooks, or allow plugin hooks. |
| `allowedMcpServers`, `deniedMcpServers` | The bridge can be blocked. | The administrator allows the `md-coeditor` server. |
| `channelsEnabled` | Off: no push. Tools and hooks still work. | The administrator switches channels on. |
| `allowedChannelPlugins` | Without an entry, push needs the development flag. | The administrator lists `md-coeditor` with its marketplace. This needs a marketplace install, not `--plugin-dir`. |

For a company, the marketplace install is the main path. `--plugin-dir` is for development and for quick tests.

## Distribution (planned)

Phase 1, development: `pnpm link:bin` puts a link to the build output on the PATH. See [install.md](install.md).

Phase 2: one npm package `md-coeditor`. It contains:

```
md-coeditor/
├── bin/coedit.mjs                 # the bridge bundle; package.json "bin": { "coedit": … }
├── obsidian-plugin/               # main.js, manifest.json, styles.css (coedit init copies these)
├── claude-plugin/                 # the Claude Code plugin, with dist/coedit.mjs
└── .claude-plugin/marketplace.json
```

- Install: `npm i -g md-coeditor`.
- Marketplace from the installed package: `claude plugin marketplace add "$(npm root -g)/md-coeditor"`.
- A company can also list the npm package in its own marketplace.

Phase 3 (optional): a true single binary (`bun build --compile` or Node SEA).

## End-to-end tests

Details: [testing.md](testing.md). In short:

- **Second test runner.** WebdriverIO 9 with mocha, because the tests must run in the real Obsidian app and wdio does not support vitest. vitest stays the main level.
- **Version pins.** The app version is the plugin's `minAppVersion` (read from `packages/obsidian/manifest.json`). The installer version is pinned (`1.14.4`) in `packages/e2e/wdio.conf.mts`.
- **Cache.** The first run downloads Obsidian to `packages/e2e/.obsidian-cache/` (ignored by git).
- **Rules.** Test names are the spec scenario names. `modKey()` for Cmd or Ctrl. No fixed sleeps. DOM menus (`nativeMenus: false`).
- **Focus.** A local run opens Obsidian windows that take the keyboard focus. Do not type during a run.
- **Docker.** `pnpm test:e2e:docker` runs the same tests in Linux (`node:24-bookworm` + xvfb), with no window. It is the everyday run; the macOS run stays before each archive.
- **Strong default.** A change to the plugin adds e2e tests for the behaviour that needs the real app (rules in `openspec/config.yaml` and [testing.md](testing.md)).

## Not now

Turborepo, changesets, CI, Codex adapter, Gemini adapter, Pi adapter, Obsidian community store.

## Checks for the spikes

Answered on 2026-10-25 (details in the design of the change `add-claude-suggest-loop`, "Checked facts"):

- F1: a plugin with `defaultEnabled: false` stays off. `--settings` with `enabledPlugins` switches it on for one session and writes no file. The user can still switch it on in `/plugin`, and that persists at user scope.
- F2: `--plugin-dir` gives the id `<manifest name>@inline`. `--settings` with `md-coeditor@inline` switches it on. A wrong id does not load the plugin.
- The esbuild ESM bundle of the MCP SDK runs alone, with no `node_modules` (about 1.4 MB).

Still open:

- S2: which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`)?
- Does `claude plugin install` at user scope switch the plugin on? (Manual check, task 12.3 of the change.)
