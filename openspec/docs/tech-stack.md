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
| Hub ⇄ bridge | WebSocket. `ws` in the plugin (server). Node's built-in `WebSocket` in the bridge (client). | Node has no built-in WebSocket server, so the plugin needs `ws`. The bridge needs no extra package. |
| Schemas | zod, in `packages/protocol` | One contract for both ends. The MCP SDK also uses zod. |
| CLI arguments | `node:util` `parseArgs` | No package needed for a few subcommands. |
| Tests | vitest. jsdom for the CodeMirror 6 tests. | Fast, TypeScript without a build. |
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
│   └── bridge/               # @md-coeditor/bridge → binary "coedit"
├── adapters/
│   └── claude/               # Claude Code plugin
├── spikes/                   # S1, S2. Throwaway. Delete when done.
├── test-vault/               # Obsidian test vault for manual tests
├── scripts/                  # Node helper scripts (link:bin, link:vault)
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

### Internal packages

- Each internal package has `"private": true` and `"exports": { ".": "./src/index.ts" }`.
- Internal packages have no build step. The bundles (plugin, bridge) and vitest compile them.
- `tsconfig.base.json` uses `"moduleResolution": "bundler"` and `"verbatimModuleSyntax": true`.

### Versions and tool settings

- **One place for versions.** Shared tools are root devDependencies. Package-specific versions are in the `catalog:` in `pnpm-workspace.yaml`. Do not write a version into a package's `package.json`.
- **CodeMirror versions.** The catalog pins `@codemirror/state` and `@codemirror/view` to the exact versions that the `obsidian` package declares as peers. When you update `obsidian`, check them again.
- **pnpm 12 settings** in `pnpm-workspace.yaml`:
  - `allowBuilds: { esbuild: true }`. pnpm 12 blocks install scripts by default, and esbuild needs its install script.
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
| `pnpm test` | Runs all tests (vitest). |
| `pnpm typecheck` | Runs `tsc --noEmit` in each package. |
| `pnpm lint` | Runs `biome check .`. |
| `pnpm format` | Runs `biome check --write .`. |
| `pnpm check` | Runs lint, typecheck and test. |
| `pnpm link:bin` | Puts `coedit` on the PATH (see [install.md](install.md)). Temporary. |
| `pnpm link:vault` | Links the plugin build into `test-vault/`. Temporary, until `coedit init --dev`. |

### macOS and Windows

- Scripts are Node scripts (`.mjs`). No shell commands (`rm -rf`, `cp`, `chmod`, `ln`) in `package.json` scripts.
- Code uses `node:path` to join paths.
- `.gitattributes` sets LF line endings on all systems.
- The Claude plugin and the tests start `coedit.mjs` with `node`. They do not use the shebang or the PATH. Windows ignores the shebang.

## Obsidian plugin

- `manifest.json` has `"isDesktopOnly": true`. The plugin uses Node APIs (`http`, `fs`).
- `minAppVersion` must not be higher than the Obsidian app on the developer's machine. Use the lower of the installed app version and the `obsidian` types version.
- The CodeMirror 6 tests use the same `@codemirror/*` versions as Obsidian. They are devDependencies only.
- Development loop: esbuild in watch mode, and the "Hot Reload" community plugin in the test vault. `coedit init --dev` links the plugin folder to `packages/obsidian/dist`.

## Claude Code plugin

```
adapters/claude/
├── .claude-plugin/plugin.json   # name "md-coeditor", defaultEnabled: false, settings.agent
├── .mcp.json                    # node "${CLAUDE_PLUGIN_ROOT}/dist/coedit.mjs" mcp
├── hooks/hooks.json             # UserPromptSubmit → node …/coedit.mjs inbox; PreToolUse guard for Edit/Write
├── agents/co-editor.md          # agent definition
└── dist/coedit.mjs              # build output
```

- **Self-contained.** When Claude Code installs a plugin from a marketplace, it copies only the plugin folder. Files outside the folder are not available. So the bridge bundle goes into `dist/` inside the plugin.
- **No `bin/` folder.** Claude Code puts a plugin's `bin/` on the PATH of the Bash tool. The agent could then run `coedit inbox --mark-read` itself and move the cursor.
- **`defaultEnabled: false`.** The plugin never switches on by itself, at any scope.
- **No `version` field** in `plugin.json`. A fixed version pins marketplace installs. The validator warning "No version specified" is expected.

### How a session loads the plugin

`coedit claude` starts Claude Code and switches on the plugin for this session only. The `--settings` flag has the scope "this session only".

| Case | Command that the launcher runs |
|---|---|
| The plugin is installed from a marketplace | `claude --settings '{"enabledPlugins":{"md-coeditor@md-coeditor":true}}'` |
| The plugin is not installed | `claude --plugin-dir <bundled plugin> --settings '{"enabledPlugins":{"md-coeditor@inline":true}}'` |

`defaultEnabled: false` also applies to `--plugin-dir`. So the launcher must pass the `--settings` value in both cases.

On Windows, `claude` can be `claude.exe` (native installer) or `claude.cmd` (npm). Node can start a `.cmd` file only with a shell. The launcher must handle both.

Later, for push, the launcher also adds `--dangerously-load-development-channels plugin:<id>` (spike S2).

### Corporate setting

An administrator can limit Claude Code with managed settings. These settings can affect MD-Coeditor:

| Managed setting | Effect on MD-Coeditor | What to do |
|---|---|---|
| `--plugin-dir` turned off | The fallback without install does not work. | Install the plugin from a marketplace that the company allows. |
| `strictKnownMarketplaces`, `blockedMarketplaces` | You can add only allowed marketplaces. | The company adds MD-Coeditor to its internal marketplace (for example with an npm source). |
| `allowManagedHooksOnly` | Our hooks do not run. Pull digest and Edit guard stop. | The administrator must deploy the hooks, or allow plugin hooks. |
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

## Not now

Turborepo, changesets, CI, Codex adapter, Gemini adapter, Pi adapter, Obsidian community store.

## Checks for the spikes

- `claude plugin install` at user scope, with `defaultEnabled: false`: does the plugin stay off? Does `--settings` switch it on for one session?
- `--plugin-dir` with `defaultEnabled: false`: does `--settings` with `md-coeditor@inline` switch it on?
- S2: which channel flag value works for each load method (`plugin:md-coeditor@md-coeditor`, `plugin:md-coeditor@inline`, `server:…`)?
- Does the esbuild ESM bundle of the MCP SDK run without problems?
