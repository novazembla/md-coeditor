# Tasks

## 1. Developer machine

- [x] 1.1 Update Node to 24.15 or newer (the machine has v24.9.0), and verify that `node --version` shows ≥ 24.15 and `pnpm --version` shows 12.x

## 2. Root workspace

- [x] 2.1 Add the root `package.json` (private, `packageManager` pnpm 12.15.0, `engines.node >=24.15`, the scripts from design D11), `pnpm-workspace.yaml` (`packages/*`, `adapters/*`, `spikes/*`, and a `catalog:` with the versions from design D2) and `.node-version`, and verify that `pnpm install` succeeds
- [x] 2.2 Add the root dev dependencies (typescript, esbuild, vitest, @biomejs/biome, @types/node), and verify that `pnpm exec tsc --version`, `pnpm exec esbuild --version`, `pnpm exec vitest --version` and `pnpm exec biome --version` show the versions from design D2
- [x] 2.3 Add `tsconfig.base.json` (design D3), `biome.json` (design D10) and the root `vitest.config.ts` with `test.projects` and `passWithNoTests` (design D7), and verify that `pnpm lint` and `pnpm test` exit with code 0
- [x] 2.4 Add the root `.gitignore` (`node_modules/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `test-vault/.obsidian/workspace*.json`, `test-vault/.obsidian/plugins/`), and add `.gitattributes` with `* text=auto eol=lf` (design D4b). Verify with `git status --ignored` that `node_modules/` is ignored

## 3. Internal packages

- [x] 3.1 Add `packages/format` and `packages/protocol` (`package.json` with `private` and `"exports": { ".": "./src/index.ts" }`, `tsconfig.json`, `src/index.ts` with `export {}`), and verify that `pnpm typecheck` passes for both

## 4. `coedit` binary

- [x] 4.1 Add `packages/bridge` (`package.json` with `bin`, `engines.node >=24`, and `build`, `dev` and `typecheck` scripts; `tsconfig.json` with Node types), and verify that `pnpm install` links the workspace package
- [x] 4.2 Implement `src/run.ts` (argument parsing, empty subcommand registry, help text from the registry, exit codes 0/1/2) and `src/cli.ts` (design D5), and add vitest tests for each scenario in `specs/coedit-cli/spec.md` (version, help, no arguments, unknown subcommand, unknown option). Verify that `pnpm test` passes.
- [x] 4.3 Add `build.mjs` (design D4: ESM bundle `dist/coedit.mjs`, banner with shebang first and then `createRequire`, version from `package.json`, `fs.chmod` 755 on macOS and Linux only), and verify that `pnpm --filter @md-coeditor/bridge build` makes an executable file on macOS, and that `./packages/bridge/dist/coedit.mjs --version` prints `0.0.0`
- [x] 4.4 Add a vitest test that runs the built `dist/coedit.mjs` with `node:child_process` and `process.execPath` (not the shebang) (`--version`, `--help`, `frobnicate`) and checks output and exit codes. It skips with a clear message if the file is not built. Verify that it passes after `pnpm build`.
- [x] 4.5 Add `scripts/link-bin.mjs` and the root script `link:bin` (design D4a: symlink on macOS and Linux, `coedit.cmd` on Windows, `COEDIT_BIN_DIR`, PATH warning, `--remove`), with vitest tests for the OS-specific parts that use a temporary folder. Verify on macOS that after `pnpm link:bin`, `cd /tmp && coedit --version` prints `0.0.0`, that a second `pnpm link:bin` succeeds with no change, and that `pnpm link:bin --remove` deletes the entry.

## 5. Claude Code plugin skeleton

- [x] 5.1 Add `adapters/claude` (`package.json` with dev dependency `@md-coeditor/bridge: workspace:*` and a `build` script that copies `dist/coedit.mjs`; `.claude-plugin/plugin.json` from design D9), and verify that `pnpm build` writes `adapters/claude/dist/coedit.mjs`, and that `node adapters/claude/dist/coedit.mjs --version` prints `0.0.0`
- [x] 5.2 Add `.claude-plugin/marketplace.json` at the repo root (design D9), and verify that `claude plugin validate adapters/claude` and `claude plugin validate .` pass with no errors

## 6. Obsidian plugin skeleton

- [x] 6.1 Add `packages/obsidian` (`package.json` with `obsidian` and the catalog `@codemirror/state` and `@codemirror/view` as dev dependencies; `tsconfig.json` with DOM types; `manifest.json` from design D6; `styles.css`; `src/main.ts` with an empty `Plugin` subclass), and verify that `pnpm typecheck` passes
- [x] 6.2 Add `esbuild.config.mjs` (design D6) with production and watch modes, and verify that `pnpm --filter @md-coeditor/obsidian build` writes `dist/main.js`, `dist/manifest.json`, `dist/styles.css` and `dist/.hotreload`, and that `dist/main.js` contains no CodeMirror code (search for `EditorView` class definitions)
- [x] 6.3 Add `packages/obsidian/vitest.config.ts` (jsdom) and a smoke test that creates an `EditorView` with a short document and reads the document back, and verify that `pnpm test` runs it in jsdom and passes

## 7. Test vault and spikes folder

- [x] 7.1 Add `test-vault/Welcome.md` and `test-vault/.obsidian/community-plugins.json` (design D8), and add `spikes/README.md` (what a spike is, delete when done, may import `packages/*`). Verify that `git status` shows these files, and does not show ignored vault files.
- [x] 7.2 Add `scripts/link-test-vault.mjs` and the root script `link:vault` (design D8), and verify that `pnpm link:vault` makes the link (a relative symlink on macOS, a junction on Windows), that a second run makes no change, and that a real folder at that path stops it with an error
- [x] 7.3 Open `test-vault` in Obsidian, turn off restricted mode, switch on MD-Coeditor, and verify that it is listed in Settings → Community plugins, and that the developer console (Cmd+Opt+I on macOS, Ctrl+Shift+I on Windows) shows no errors from the plugin

## 8. Documentation

- [x] 8.1 Update `openspec/docs/tech-stack.md`, `openspec/docs/architecture.md`, `openspec/docs/install.md`, `README.md` and `CLAUDE.md`: pnpm 12 (not 10), Node `>=24.15` for development, macOS and Windows as supported systems (no other machine-specific notes), `coedit.mjs` (not `coedit.js`), `pnpm link:bin` (not `pnpm link --global`), the root scripts, and in install.md which steps work now and which come with slice 1. Verify with `grep -rn "coedit\.js\b\|link --global\|pnpm 10" README.md CLAUDE.md openspec/docs` that there are no old values.
- [x] 8.2 Follow `openspec/docs/install.md` steps 1 and 2 exactly as written, and verify that they work

## 9. Integration check

- [x] 9.1 Remove all `node_modules/` and `dist/` folders, then run `pnpm install && pnpm build && pnpm check`, and verify that each command exits with code 0
- [x] 9.2 Run `openspec validate setup-monorepo --strict`, and verify that it passes
- [x] 9.3 Manual check on a Windows machine (by the user): follow install.md steps 1 and 2 in PowerShell, run `pnpm check`, run `coedit --version` from another folder in Command Prompt and in PowerShell, run `pnpm link:vault`, and load the plugin in Obsidian. Verify that each step works.

## Workflow follow-up

- Commit the change on a branch, after review.
- Archive the change with `/opsx:archive`. This creates `openspec/specs/coedit-cli/spec.md`.
