# Design

## Context

The repo has no code. The tool choices are already made and accepted in `openspec/docs/tech-stack.md` (pnpm workspaces, TypeScript, esbuild, vitest, Biome, Node 24 LTS). This design only decides how to set them up. See proposal.md for the reason.

Constraints:

- Desktop only (no Obsidian mobile). It must work on macOS and Windows. Linux should work, but it is not a test target.
- Claude Code only. Codex is deferred.
- Obsidian loads plugins as CommonJS and gives plugins its own CodeMirror 6. A plugin must not bundle its own CodeMirror.
- A Claude Code plugin that is installed from a marketplace is copied without the files outside its folder.

## Goals / Non-Goals

**Goals:**

- `pnpm install && pnpm build && pnpm check` passes on a clean clone.
- `coedit --version` works from any folder after `pnpm link:bin`, on macOS and on Windows.
- The Obsidian plugin skeleton loads in the test vault with no errors.
- `claude plugin validate` accepts the Claude plugin skeleton and the local marketplace.
- Test setups are ready for slice 1: unit tests in Node, and CodeMirror tests in jsdom.

**Non-Goals:**

- Product features: markup parsing, the hub, MCP tools, hooks, the agent definition.
- `coedit init`. A temporary script links the test vault until `init` exists.
- CI, publishing, the npm package, a single binary.

## Decisions

### D1. Workspace and package names

`pnpm-workspace.yaml` lists `packages/*`, `adapters/*` and `spikes/*`. All packages are `private`.

| Folder | Package name |
|---|---|
| `packages/format` | `@md-coeditor/format` |
| `packages/protocol` | `@md-coeditor/protocol` |
| `packages/obsidian` | `@md-coeditor/obsidian` |
| `packages/bridge` | `@md-coeditor/bridge` (`"bin": { "coedit": "dist/coedit.mjs" }`) |
| `adapters/claude` | `@md-coeditor/claude-plugin` |

`adapters/claude` has a dev dependency `@md-coeditor/bridge: workspace:*`. Then `pnpm -r build` builds the bridge first, and the plugin build can copy its output.

### D2. Versions in one place

Shared tools (TypeScript, esbuild, vitest, Biome, `@types/node`) are root dev dependencies. Package-specific versions go into a pnpm `catalog:` in `pnpm-workspace.yaml`, and packages refer to them with `"catalog:"`. Most important: the `@codemirror/*` test versions must match the versions that the `obsidian` package declares.

Alternative: versions in each `package.json`. Rejected: versions drift between packages.

pnpm 12 settings in `pnpm-workspace.yaml` (found during apply):

- `allowBuilds: { esbuild: true }`. pnpm 12 blocks install scripts by default, and esbuild needs its install script.
- `minimumReleaseAgeExclude` lists `@biomejs/biome@2.6.3` and its `@biomejs/cli-*` platform packages. pnpm's minimum release age blocked them, because 2.6.3 was too new. The entries pin exact versions: update or remove them when we update Biome.

The root `package.json` sets `"packageManager"` (exact pnpm version) and `"engines": { "node": ">=24.15" }`. This is the development minimum, because jsdom 30 needs Node ^24.15. The bridge package sets `"engines": { "node": ">=24" }`, because the `coedit` runtime needs no jsdom. `.node-version` contains `24`. Node 24 is in Maintenance LTS since 2026-10-20, and Node 26 becomes Active LTS on 2026-10-28. Both ranges accept Node 26. We move the development default to 26 in a later change.

Observed on the developer machine (2026-10-24): Node v24.22.1, pnpm 12.15.0, Claude Code 2.1.310, Obsidian 1.14.5.

Versions checked with `npm view` on 2026-10-24:

| Package | Version | Note |
|---|---|---|
| pnpm | 12.15.0 | `packageManager` field |
| typescript | ^7.0.2 | Native compiler. Fallback: `typescript@6` if the `obsidian` types fail. |
| esbuild | ^0.28.2 | |
| vitest | ^5.0.5 | Needs Node ^22.12, ^24 or >=26 |
| jsdom | ^30.1.3 | Needs Node ^24.15 or >=26 |
| @biomejs/biome | ^2.6.3 | |
| @types/node | ^24 | Same major as the lowest supported runtime |
| obsidian | 1.14.4 | Types only |
| @codemirror/state | 6.7.6 (exact) | The version that `obsidian` declares as peer |
| @codemirror/view | 6.43.13 (exact) | The version that `obsidian` declares as peer |

### D3. TypeScript without a build of internal packages

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `module: "ESNext"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `noEmit`. Each package has a `tsconfig.json` that extends the base and sets its own `lib` and `types` (DOM for Obsidian, `node` for the bridge).

Internal packages export source: `"exports": { ".": "./src/index.ts" }`. TypeScript (bundler resolution), esbuild and vitest all resolve this directly.

Type check: each package has `"typecheck": "tsc -p . --noEmit"`. The root runs `pnpm -r typecheck`.

Alternative: project references and `tsc -b` with `.d.ts` output. Rejected: more config, and nothing needs the emitted files.

### D4. The `coedit` bundle

`packages/bridge/build.mjs` runs esbuild:

- entry `src/cli.ts` → `dist/coedit.mjs`
- `platform: "node"`, `target: "node24"`, `format: "esm"`, `bundle: true`
- banner: the shebang line `#!/usr/bin/env node`, and a `createRequire` line so that bundled CommonJS code can call `require`
- `define`: the version from `packages/bridge/package.json`
- after the build, on macOS and Linux: `chmod 755 dist/coedit.mjs` (with `fs.chmod`, not a shell command). Windows has no executable bit and ignores the shebang (see D4a).

The extension is `.mjs`, not `.js`. Node then treats the file as ESM wherever it is, also when it is copied into the Claude plugin or a plugin cache, and it does not depend on a `"type": "module"` field nearby. **This changes the docs:** they say `coedit.js` and must say `coedit.mjs`.

`pnpm dev` runs the same build in watch mode.

### D4a. Put `coedit` on the PATH

pnpm 11 removed `pnpm link --global`. Its replacement, `pnpm add -g <folder>`, is not verified for a local folder: it can copy the package, and then each build needs a new install.

So `scripts/link-bin.mjs` (root script `pnpm link:bin`) puts a small entry in a bin folder. The entry points to the build output, so a new build needs no new link. The method depends on the OS:

| OS | Default bin folder | Entry |
|---|---|---|
| macOS, Linux | `~/.local/bin` | Symlink `coedit` → `packages/bridge/dist/coedit.mjs`. The shebang line starts Node. |
| Windows | `%LOCALAPPDATA%\md-coeditor\bin` | File `coedit.cmd` with `@node "<absolute path>\coedit.mjs" %*`. Windows ignores the shebang, and a symlink needs admin rights or developer mode. Command Prompt and PowerShell both run `.cmd` files. |

The environment variable `COEDIT_BIN_DIR` can change the folder. The script:

- creates the folder if it is missing
- replaces an entry that it made before, but stops with an error if another file has that name. On macOS and Linux, a symlink is its own entry if its target ends in `packages/bridge/dist/coedit.mjs` (so a moved repo gets linked again). On Windows, `coedit.cmd` is its own entry if line 1 is the marker `@rem md-coeditor: coedit launcher (made by pnpm link:bin)`
- shows a warning if the folder is not on the PATH, with the instruction for this OS
- with `--remove`, deletes the entry

Alternative: `pnpm add -g ./packages/bridge`. pnpm makes the `.cmd` shims on Windows itself. It stays in install.md as a "not verified" option.

### D4b. Rules for macOS and Windows

- **No shell commands in scripts.** Build and helper scripts are Node scripts (`.mjs`) that use `node:fs` and `node:path`. No `rm -rf`, `cp`, `chmod` or `ln` in `package.json` scripts.
- **No fixed path separators.** Code uses `node:path` to join paths.
- **Line endings.** `.gitattributes` sets `* text=auto eol=lf`, so that Biome and the tests see the same files on both systems.
- **Claude plugin calls Node directly.** Hooks and `.mcp.json` (slice 1) run `node "${CLAUDE_PLUGIN_ROOT}/dist/coedit.mjs" …`. They do not need the shebang or the PATH.
- **Tests run the bundle with Node.** Tests start `process.execPath` with the path to `coedit.mjs`. They do not use the shebang.

### D5. CLI structure and exit codes

`src/cli.ts` only calls `run(process.argv.slice(2), io)` and exits with the result. `run` is in `src/run.ts`:

- It parses arguments with `node:util` `parseArgs`.
- Subcommands are in a registry (name, one-line description, handler). The registry is empty in this change. Later changes add `init`, `claude`, `inbox` and `mcp`. The help text is made from the registry.
- `io` contains `stdout`, `stderr` and the version. Tests pass fakes and check the output and the exit code.

Exit codes: 0 success, 1 runtime error, 2 usage error. This is the common convention for command-line tools.

Alternative: commander or citty. Rejected for now: `parseArgs` is enough for four subcommands, and it adds no dependency.

### D6. Obsidian plugin build

`packages/obsidian/esbuild.config.mjs` follows the official sample plugin:

- entry `src/main.ts` → `dist/main.js`, `format: "cjs"`, target `es2022`, `platform: "node"`
- external: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, and the Node built-in modules with and without the `node:` prefix
- inline source map in watch mode, none in the production build
- it copies `manifest.json` and `styles.css` into `dist/`, and writes an empty `dist/.hotreload` file (for the optional Hot Reload community plugin)

`manifest.json`: id `md-coeditor`, name `MD-Coeditor`, version `0.0.0`, `isDesktopOnly: true`. `minAppVersion` must not be higher than the Obsidian app on the developer's machine. Use the lower of the installed app version and the `obsidian` types version: `1.14.4` (app 1.14.5, types 1.14.4).

`src/main.ts` contains a `Plugin` subclass with empty `onload` and `onunload`.

### D7. Test setup

The root `vitest.config.ts` uses `test.projects` with `packages/*` and `adapters/*`, and one inline project `scripts` for `scripts/**/*.test.mjs` (the `link-bin` tests). So `pnpm test` runs all tests at once. `passWithNoTests` is on, because `format` and `protocol` have no tests yet. Note: vitest still fails if no folder matches the project globs.

`packages/obsidian/vitest.config.ts` sets `environment: "jsdom"`. A smoke test creates an `EditorView` from `@codemirror/view` with a short document and reads it back. This shows that the test setup works before slice 1 needs it.

At runtime the `obsidian` package contains only types. When slice 1 tests import plugin code, they need an alias to a stub. That is not needed now.

### D8. Test vault

`test-vault/` is in git with:

- `Welcome.md`: a short note that tells the user what the vault is for.
- `.obsidian/community-plugins.json` with `["md-coeditor"]`.

Git ignores `test-vault/.obsidian/workspace*.json` and `test-vault/.obsidian/plugins/`.

`scripts/link-test-vault.mjs` (root script `pnpm link:vault`) links `test-vault/.obsidian/plugins/md-coeditor` to `packages/obsidian/dist`. On macOS and Linux it makes a relative symlink. On Windows it makes a directory junction with an absolute target, because a junction needs no admin rights or developer mode. If the link already exists, it does nothing. If a link points somewhere else, it replaces the link and shows the old target. If a real folder or file is there, it stops with an error. It never deletes a real folder. This script is temporary. `coedit init --dev` replaces it and uses the same link method.

### D9. Claude plugin skeleton and local marketplace

`adapters/claude/.claude-plugin/plugin.json`: `name: "md-coeditor"`, `displayName: "MD-Coeditor"`, a description, `author`, `defaultEnabled: false`. No `version` field: a fixed version would pin marketplace installs. No hooks, no MCP config and no agent yet. They come in slice 1, together with the subcommands that they call.

The `build` script of `adapters/claude` copies `packages/bridge/dist/coedit.mjs` to `adapters/claude/dist/coedit.mjs`.

`.claude-plugin/marketplace.json` at the repo root: name `md-coeditor`, a description, owner, and one plugin `md-coeditor` with source `./adapters/claude`. The description stops a validator warning. The validator still warns "No version specified". That is expected (see above).

Check: `claude plugin validate adapters/claude` and `claude plugin validate .`.

### D10. Lint and format

`biome.json` at the root, with Biome's default style. It ignores `dist/`, `node_modules/`, `test-vault/`, `openspec/`, `.claude/`, `pnpm-lock.yaml` and `**/*.md`. Biome 2.6 formats Markdown, and it changes content (for example `@codemirror/*` becomes `@codemirror/_`). So Markdown is not checked. `pnpm lint` runs `biome check .`, and `pnpm format` runs `biome check --write .`.

### D11. Root scripts

| Script | Command |
|---|---|
| `build` | `pnpm -r build` |
| `dev` | `pnpm -r --parallel dev` |
| `test` | `vitest run` |
| `typecheck` | `pnpm -r typecheck` |
| `lint` | `biome check .` |
| `format` | `biome check --write .` |
| `check` | `pnpm lint && pnpm typecheck && pnpm test` |
| `link:vault` | `node scripts/link-test-vault.mjs` |
| `link:bin` | `node scripts/link-bin.mjs` |

## Risks / Trade-offs

- [The `@codemirror/*` test versions drift from the versions in Obsidian] → Pin them in the catalog to the versions that the `obsidian` package declares. Check them again when we update `obsidian`.
- [Bundled CommonJS code calls `require` in the ESM bundle and fails] → The `createRequire` banner (D4). The smoke test runs the built file, not only the source.
- [The bin folder is not on the PATH] → `pnpm link:bin` shows a warning and the instruction for this OS.
- [There is no Windows machine for the checks now, so Windows faults show late] → The rules in D4b, and a manual Windows check (task 9.3). A CI matrix for macOS and Windows comes in a later change.
- [Slice 1: on Windows, `claude` can be `claude.exe` (native installer) or `claude.cmd` (npm). Node can start a `.cmd` file only with a shell] → The launcher change must handle both. This change does not start `claude`.
- [TypeScript 7 is new, and the `obsidian` types or other types fail with it] → Fall back to `typescript@6`. Only the type check uses `tsc`. esbuild and vitest do not use it.
- [Biome has no Obsidian-specific lint rules. The official sample plugin uses `eslint-plugin-obsidianmd`] → Accepted for now. Add that ESLint plugin only if we publish to the community store.
- [The test-vault link points to an absolute path (Windows junction), so a copied repo has a broken link] → Git ignores the link. `pnpm link:vault` makes it again.
- [The internal packages export TypeScript source, so they cannot be published as they are] → They are private. The npm package (later) contains only bundles.
- [The empty `format` and `protocol` packages look like dead code] → They fix the package boundaries now. Slice 1 fills them.

## Migration Plan

None. The repo has no code yet. To undo the change, remove the new files.
