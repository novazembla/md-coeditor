# Proposal

## Why

The vision promises "a review model that people know" and a user who "stays in control". The user sees each change inline and decides about it. That promise holds only if the cursor, the keys, the menu and the commands behave correctly in the real Obsidian app. Change 2 (`add-obsidian-review-basics`) tested its CodeMirror logic in jsdom. jsdom has no layout and no Obsidian, so 16 scenarios of `markup-rendering` and `change-decisions` are `test.todo` with a pointer to a manual check. A real bug (two key presses at a mark edge) passed all unit tests and was found only by hand. Manual checks are slow and are not repeated after each change.

Change 3 (`add-claude-suggest-loop`) adds the hub inside the plugin and the slice 1 end-to-end test. It needs a way to run tests in the real app. This change builds that way first, on the current plugin, where the scope is small.

## What Changes

- **A new package `packages/e2e/`** (`@md-coeditor/e2e`, private). It runs end-to-end tests in the real Obsidian app with [wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service) (WebdriverIO, mocha). The service downloads a pinned Obsidian version, copies a fixture vault into a sandbox, installs the built plugin from `packages/obsidian/dist`, and runs the tests.
- **A fixture vault** in `packages/e2e/` with one note for each test area. `test-vault/` stays for manual tests and is not used by the e2e tests.
- **A root script `pnpm test:e2e`**. It builds the plugin, then runs the e2e tests. It is not part of `pnpm check`, because it is slow and needs a display.
- **First tests:**
  - the 16 scenarios that are now `test.todo` in `packages/obsidian/src/markup-rendering.spec.test.ts` and `packages/obsidian/src/change-decisions.spec.test.ts`: cursor and keys over hidden syntax, the hover tooltip, the right-click menu, the command palette, notices, Reading view, Source mode, and a change of the file on disk
  - a regression test for the change 2 bug (two key presses at a mark edge)
  - undo after accept and after reject in the real app, also for a mark without an id
- **Traceability:** each e2e test has the name of its scenario. The matching `test.todo` changes to a pointer to the e2e test.
- **Platforms:** macOS, and Linux in Docker. The tests are written so that Windows can be added later with little work (Node scripts only, one helper for the Cmd or Ctrl key, DOM menus instead of native menus, no headless assumptions).
- **A run without a window: `pnpm test:e2e:docker`** (added during apply, on the user's request). A local run on macOS opens Obsidian windows that take the keyboard focus, and keys typed during a run go into the test notes. Obsidian has no headless mode. The Docker script runs the same tests in Linux with a virtual display (xvfb), so nothing shows on the desktop. It also covers the open check "the e2e tests run on Linux".
- **E2E tests become the strong default for changes to the plugin** (added during apply, on the user's request). The OpenSpec rules (`openspec/config.yaml`) and `CLAUDE.md` tell agents that write designs, tasks and tests to add e2e tests for behaviour that needs the real app.

Not in this change: CI (a later change), runs on Windows, the slice 1 end-to-end test (change 3), tests for colours and themes (they stay manual).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change adds test tooling and tests only. No behaviour of the plugin changes. The change sets `skip_specs: true`.

## Impact

- **Code:** new package `packages/e2e/` (wdio config, helpers, tests, fixture vault). `packages/obsidian/src/*.spec.test.ts`: the 16 `test.todo` entries change to pointers. No plugin code changes, unless a test finds a bug.
- **Dependencies:** new devDependencies in `packages/e2e` only: `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `webdriverio`, `wdio-obsidian-service`, `wdio-obsidian-reporter`. The downloaded Obsidian versions go to a cache folder that git ignores.
- **Tooling:** root `package.json` gets `test:e2e` and `test:e2e:docker` (a Node script that runs `docker build` and `docker run`; needs Docker Desktop or another Docker engine). The root vitest config must not run the e2e files. `pnpm -r typecheck` also checks `packages/e2e`.
- **Docs:**
  - `openspec/docs/roadmap.md`: the status of change 12; remove change 12 from `markup-rendering` in the Capabilities table; a new open check "the e2e tests run on Windows and Linux"; the open Windows check of change 2 names change 12 as the way to close it.
  - `openspec/docs/tech-stack.md`: wdio and mocha as the second test runner, the `packages/e2e` package, the `pnpm test:e2e` script, and the e2e rules.
  - `openspec/docs/architecture.md`: the note on native menus in end-to-end tests gets the chosen approach.
  - `openspec/docs/testing.md` (new): the test levels, the e2e setup, the Docker run, and when a change must add e2e tests.
  - `openspec/config.yaml` and `CLAUDE.md`: rules that make e2e tests the strong default for plugin behaviour.
