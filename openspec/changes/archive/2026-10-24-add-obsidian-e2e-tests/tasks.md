# Tasks

## 1. Toolchain spike

- [x] 1.1 Create `packages/e2e` (design D1): `package.json` (`@md-coeditor/e2e`, private, scripts `test:e2e` and `typecheck`), `tsconfig.json` (extends `tsconfig.base.json`, wdio and mocha types), and the devDependencies `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `webdriverio`, `wdio-obsidian-service`, `wdio-obsidian-reporter`. Add `packages/e2e/.obsidian-cache/` to `.gitignore`. Verify that `pnpm install` succeeds and that `git status` does not show the cache folder after a run
- [x] 1.2 Write `wdio.conf.mts` (design D2): `browserVersion: "earliest"`, a pinned `installerVersion` that runs app 1.14.4 (with a comment on why), `cacheDir`, the plugin folder `../obsidian/dist`, the vault `vault/`, mocha, the obsidian reporter. Verify that the config loads with `wdio run`. If it does not load with TypeScript 7, change to `wdio.conf.mjs` with JSDoc types and record the reason in design.md (Risks)
- [x] 1.3 Add a minimal fixture vault (`vault/.obsidian/app.json` with `nativeMenus: false`, `appearance.json`, one note) and `tests/smoke.e2e.ts`: the vault opens and `app.plugins.plugins["md-coeditor"]` is loaded. Verify that `pnpm --filter @md-coeditor/e2e test:e2e` passes on macOS and that `pnpm --filter @md-coeditor/e2e typecheck` passes
- [x] 1.4 Keep the e2e package out of vitest (design D7): `.e2e.ts` file names, and a `vitest.config.ts` in `packages/e2e` with no test files, or an exclude in the root config (choose the simpler one). Add the root script `test:e2e` (build the plugin, then run the e2e package). Verify that `pnpm check` passes, runs no e2e file and does not start Obsidian, and that `pnpm test:e2e` runs the smoke test from a clean `packages/obsidian/dist`

## 2. Helpers and fixture vault

- [x] 2.1 Implement the helpers in `packages/e2e/helpers/` (design D5): `modKey`, `openNote` (Live Preview, Source mode, Reading view), `setCursor` and `cursor`, `docText` and `fileText`, `rightClickOn` and `menuItems`, `paletteItems`, `notices`, `writeOnDisk`. Use `node:path` for paths and `waitUntil` for waits, no fixed sleeps. Extend `smoke.e2e.ts` with one call of each helper on the smoke note. Verify that the smoke tests pass and that a search for `pause(` and for `Meta` or `Control` in `packages/e2e/tests` finds nothing
- [x] 2.2 Add the fixture notes (design D3): `cursor.md`, `decisions.md`, `undo.md`, `modes.md`, `reload.md`, `no-changes.md`, with only the text each test needs. Add `resetVault()` before each test in a shared mocha hook. Verify that two runs in a row pass and that the files in `packages/e2e/vault` are unchanged after the runs (`git status`)

## 3. Cursor, keys and hover

- [x] 3.1 Add `tests/cursor.e2e.ts` (design D6) with the scenarios "Arrow key over the hidden prefix", "Backspace at the start of an insertion" and "Insertion with attributes", named exactly as in `openspec/specs/markup-rendering/spec.md`, and the regression test for two key presses at a mark edge (one key press moves one visible character, in both directions). Verify that the tests pass, and that the regression test fails when the `motion.ts` keymap is removed from `coeditExtension` (undo that change after the check)
- [x] 3.2 Add `tests/hover.e2e.ts` with "Author and date" and "No attributes": move the mouse to the content span and compare the `.tooltip` text. If the tooltip display is not stable, test the `aria-label` in the real DOM, record the reason in the test and in design.md (Risks), and keep the display in the manual list. Verify that the tests pass three runs in a row
- [x] 3.3 Change the matching `test.todo` texts in `packages/obsidian/src/markup-rendering.spec.test.ts` to pointers (`"<scenario>: e2e in packages/e2e/tests/<file>.e2e.ts"`, design D6). Verify that `pnpm test` passes and that each scenario name of this group appears in both files

## 4. Decisions: menu, palette, notices, undo

- [x] 4.1 Add `tests/menu.e2e.ts` with "Reject from the menu", "Right-click on plain text" and "Right-click in Reading view" (DOM menu, design D4). Compare the menu item titles and, for the reject, the editor text and the file text after the click. Verify that the tests pass
- [x] 4.2 Add `tests/palette.e2e.ts` with "Accept with the cursor inside an insertion" and "Source mode": the command palette lists or does not list "Accept change", "Reject change", "Go to next change" and "Go to previous change", and the accept from the palette changes the text. Verify that the tests pass
- [x] 4.3 Add `tests/notices.e2e.ts` with "No mark at the cursor", "Substitution at the cursor" and "No changes". Compare the notice texts with the texts in the specs. Verify that the tests pass and that the note text is unchanged after each test
- [x] 4.4 Add `tests/undo.e2e.ts`: undo after accept, undo after reject (`modKey()` + `z`, one key press gives back the exact text before the decision), and an id-less mark has no id in the editor and in the file after undo. Verify that the tests pass
- [x] 4.5 Change the matching `test.todo` texts in `packages/obsidian/src/change-decisions.spec.test.ts` and `markup-rendering.spec.test.ts` to pointers. Verify that `pnpm test` passes and that each scenario name of this group appears in both files

## 5. Modes and changes on disk

- [x] 5.1 Add `tests/modes.e2e.ts` with "Insertion and deletion in Reading view" (classes and visible text in the rendered view) and "Raw mark in Source mode" (the full mark syntax is visible). Verify that the tests pass
- [x] 5.2 Add `tests/reload.e2e.ts` with "Changes from outside the editor are not filtered": with the note open, `writeOnDisk` changes the text over a mark; the editor shows the new text and the file has it. Verify that the test passes
- [x] 5.3 Change the remaining `test.todo` texts to pointers. Verify that `pnpm test` passes and that no `test.todo` in `packages/obsidian/src` still points to a manual test 11.3 to 11.5

## 6. Docs

- [x] 6.1 Update `openspec/docs/tech-stack.md`: wdio and mocha as the second test runner and why, the `packages/e2e` package in the layout, the `pnpm test:e2e` script, the version pins and the cache folder, the e2e rules (scenario names, `modKey`, no fixed sleeps, DOM menus), and that a local run takes the focus of the desktop. Verify that the documented `pnpm test:e2e` command runs as written
- [x] 6.2 Update `openspec/docs/architecture.md`: the note on native menus in end-to-end tests gets decision D4. Verify by reading the section
- [x] 6.3 Update `openspec/docs/roadmap.md`: change 12 no longer in the `markup-rendering` row of the Capabilities table, the slice 1 entry of change 12 (capabilities: none, `skip_specs`; the open points answered), a new open check "the e2e tests run on Windows and Linux", and the Windows check of change 2 names change 12 as the tool to close it. Verify that `openspec validate add-obsidian-e2e-tests` passes and that the roadmap matches the proposal

## 7. Integration checks

- [x] 7.1 Run `pnpm check`. Verify that lint, type checks and all tests pass, and that no Obsidian window opens
- [x] 7.2 Run `pnpm test:e2e` three times in a row on macOS. Verify that all runs pass with no retry
- [x] 7.3 Manual check: the remaining manual list (colours, light and dark theme, user-set hotkeys, one look at the native macOS menu with `nativeMenus` on). Verify that each item matches the specs, or record the difference
  - Result (2026-10-24, by the user, macOS, `test-vault/`): light and dark theme OK. User-set hotkeys OK. Native macOS menu works (items and click); it shows no icons, which no spec asks for (the native display is Obsidian's code).

## 8. Linux in Docker and e2e as the default (added during apply)

- [x] 8.1 Add `packages/e2e/docker/Dockerfile` and a root `.dockerignore` (design D9). Verify that `docker build` succeeds on this Mac (arm64) and that a second build after a change in `packages/obsidian/src` does not run `pnpm install` again
- [x] 8.2 Add `scripts/e2e-docker.mjs` and the root script `test:e2e:docker` (Node `spawn`, no shell; cache volume; `--shm-size=1g`; `xvfb-run -a`). Verify that `pnpm test:e2e:docker` passes all e2e tests, that no Obsidian window opens on the desktop, and that a second run does not download Obsidian again
- [x] 8.3 Run `pnpm test:e2e:docker` three times in a row. Verify that all runs pass with no retry. If a test fails only on Linux, fix the test (not the plugin, unless it is a real bug; then stop and decide with the user)
- [x] 8.4 Add the rules of design D10 to `openspec/config.yaml` (design and tasks) and a "Testing" section to `CLAUDE.md`. Verify that `openspec instructions tasks --change add-obsidian-e2e-tests --json` shows the new rules
- [x] 8.5 Update `openspec/docs/testing.md`, `tech-stack.md` and `roadmap.md` (the Docker run; the open check is now "the e2e tests run on Windows"; Linux runs in Docker). Verify that the documented commands run as written and that `openspec validate add-obsidian-e2e-tests` passes

## Workflow follow-up

- Before archive, copy lasting design decisions (D1 package, D2 version pins, D4 DOM menus, D6 test names) into `openspec/docs/tech-stack.md` and `openspec/docs/architecture.md`, if group 6 did not already do it.
- Archive the change, then set its roadmap status to "archived". No "Main spec exists" column changes, because the change has no specs.
