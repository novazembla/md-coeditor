# Design

## Context

See proposal.md for the why and the scope. The current state:

- `vitest.config.ts` at the root makes each folder in `packages/*` a vitest project. `pnpm check` runs all of them. vitest's default file pattern is `*.test.ts` and `*.spec.ts`.
- `pnpm -r typecheck` runs `tsc --noEmit` in each package. TypeScript is 7.
- `packages/obsidian` builds to `packages/obsidian/dist` (`main.js`, `manifest.json`, `styles.css`, `.hotreload`). `minAppVersion` is 1.14.4. The `obsidian` types in the catalog are 1.14.4.
- `main.ts` registers four commands with `editorCheckCallback` (`accept-change`, `reject-change`, `next-change`, `previous-change`), an `editor-menu` handler, and a Markdown post-processor. Commands are available only in Live Preview.
- `test-vault/` is the manual test vault. Its plugin folder is a symlink to `dist`, and it lists `hot-reload`, which is not in git.
- `architecture.md` says that on macOS the right-click menu is native, so the DOM does not show it.
- wdio-obsidian-service downloads Obsidian versions (`browserVersion`, `installerVersion`), copies a vault into a sandbox, installs plugins from folders (`plugins`), and has helpers: `browser.executeObsidian`, `browser.executeObsidianCommand`, `browser.reloadObsidian`, `obsidianPage.resetVault`. The test framework is mocha (wdio does not support vitest).

## Goals / Non-Goals

**Goals:**
- Each of the 16 `test.todo` scenarios has one e2e test with the same name, and each one runs on macOS.
- One command (`pnpm test:e2e`) builds the plugin and runs all e2e tests from a clean state.
- The tests do not depend on the machine: no fixed paths, no user settings, no `test-vault/`.
- Windows and Linux can be added later with config changes only, not test changes.

**Non-Goals:**
- No CI workflow. (The Docker image of D9 is the base for it later.)
- No screenshot or pixel tests. Colours and themes stay manual.
- No test of the plugin against several Obsidian versions in one run. One pinned version only.
- No change to plugin behaviour. If a test finds a bug, the fix is a separate task in this change, with the spec unchanged. If the fix needs a spec change, stop and decide with the user.

## Decisions

### D1. A separate package `packages/e2e`

```
packages/e2e/
  package.json          @md-coeditor/e2e, private, scripts: test:e2e, typecheck
  tsconfig.json         extends tsconfig.base.json, wdio and mocha types
  wdio.conf.mts         service, version pins, vault, plugin folder
  vault/                fixture vault (D3)
  helpers/              keys, editor, menu, notices, files (D5)
  tests/*.e2e.ts        one file per area (D6)
```

The package has no `exports` and no build. It uses the plugin build from `../obsidian/dist`. Change 3 adds the bridge as a dependency for the slice 1 test.

Alternative: `packages/obsidian/e2e/`. Rejected: the wdio devDependencies are large and would mix with the plugin's, and the slice 1 test uses more packages than the plugin.

### D2. Version pins

- `browserVersion`: the `minAppVersion` (1.14.4) of the plugin manifest. When `minAppVersion` changes, the e2e version changes with it. The config reads `packages/obsidian/manifest.json` itself: the service's `"earliest"` looks for `manifest.json` only in the parent folders of the working folder, and the plugin manifest is not there (found in task 1.2).
- `installerVersion: "1.14.4"`. The installer brings Electron, and a new installer can change behaviour without a change in the app version. App 1.14.4 runs with installers 1.5.8 to 1.14.4. 1.14.4 is the newest of them (Electron 43.7.7), so it is near to what new users have.
- wdio 9, not 10: `wdio-obsidian-service` 3.3 needs `webdriverio` ^9. The service needs the native build of `classic-level`; the `edgedriver` and `geckodriver` builds are off in `pnpm-workspace.yaml` (`allowBuilds`), because Obsidian uses the Electron chromedriver.
- `cacheDir`: `packages/e2e/.obsidian-cache`, ignored by git. The first run downloads Obsidian. Later runs use the cache.
- No beta versions: they need an Insiders account.

Alternative: `"latest"`. Rejected: the tests then change without a change in the repo. A run against `"latest"` can be added later as a separate, optional command.

### D3. Fixture vault

```
packages/e2e/vault/
  .obsidian/
    app.json            { "nativeMenus": false, ... } (D4)
    appearance.json     fixed theme
  cursor.md             marks for cursor and key tests
  decisions.md          marks for palette, menu and notice tests
  undo.md               marks with and without ids
  modes.md              marks for Reading view and Source mode
  reload.md             the note that changes on disk
  no-changes.md         a note without marks
```

- The service installs the plugin from `packages/obsidian/dist` and enables it. The vault lists no other community plugins.
- Each note holds only the text its tests need. The exact text goes in the test as a constant too, so a failed test shows the expected text.
- Between tests, `obsidianPage.resetVault()` puts the notes back. `browser.reloadObsidian()` is used only if a test changes the app config.
- Settings that change editor behaviour (for example `livePreview`, `vimMode`, auto-pair) are set in `app.json`, so the user's defaults do not matter.

### D4. DOM menus, not native menus

`app.json` sets `nativeMenus: false`. The right-click menu is then a DOM `.menu` with `.menu-item` elements on all platforms. The tests right-click on a mark, read the item titles, and click an item.

Alternative: patch Obsidian's `Menu` in `executeObsidian` and read the items that the plugin adds. Rejected for now: it does not test the click path. Users with native menus get the same `Menu` object from Obsidian, so the plugin code path is the same.

Update the note in `architecture.md` with this decision.

### D5. Helpers

| Helper | Does |
|---|---|
| `modKey()` | `Key.Command` on macOS, `Key.Control` on Windows and Linux. Tests never write `Meta` or `Control` directly. |
| `openNote(path, mode)` | Opens a note in Live Preview, Source mode or Reading view (`setViewState`), and waits until the view is ready. |
| `setCursor(text)` / `cursor()` | Sets or reads the cursor as an offset in the document text, through the editor (`executeObsidian`). A test can also give the place as "after the word X", so the offsets do not appear in the tests. |
| `docText()` | The editor text. `fileText()` reads the file on disk. |
| `rightClickOn(selector or text)` / `menuItems()` | Right-click at a visible span, read the `.menu-item` titles. |
| `paletteItems(query)` | Opens the command palette, types the query, reads the suggestion titles, closes the palette. |
| `notices()` | The texts of the visible `.notice` elements. Tests wait for a notice; they never use a fixed sleep. |
| `writeOnDisk(path, text)` | Writes the file with Node fs in the sandbox vault (the path comes from `app.vault.adapter.getBasePath()`), so Obsidian sees a change from outside. |

Helpers wait for a condition (`waitUntil`) with a short timeout, never for a fixed time.

### D6. Tests and names

| File | Scenarios (names from the specs) |
|---|---|
| `cursor.e2e.ts` | Arrow key over the hidden prefix; Backspace at the start of an insertion; Insertion with attributes; the regression test for two key presses at a mark edge |
| `hover.e2e.ts` | Author and date; No attributes |
| `menu.e2e.ts` | Reject from the menu; Right-click on plain text; Right-click in Reading view |
| `palette.e2e.ts` | Accept with the cursor inside an insertion; Source mode |
| `notices.e2e.ts` | No mark at the cursor; Substitution at the cursor; No changes |
| `modes.e2e.ts` | Insertion and deletion in Reading view; Raw mark in Source mode |
| `reload.e2e.ts` | Changes from outside the editor are not filtered |
| `undo.e2e.ts` | Undo after accept, undo after reject, an id-less mark has no id after undo |

- The `describe` name is the spec capability (`markup-rendering`, `change-decisions`). The `it` name is the scenario name, exactly as in the spec. Then a search for a scenario name finds the spec, the vitest file and the e2e test.
- In `packages/obsidian/src/*.spec.test.ts`, each of the 16 `test.todo` texts changes to `"<scenario>: e2e in packages/e2e/tests/<file>.e2e.ts"`. They stay `test.todo`, so vitest shows them as covered elsewhere and `pnpm check` does not need Obsidian.
- The regression test and the undo tests are not spec scenarios. Their names say what they check.

### D7. Scripts and isolation from `pnpm check`

- Root `package.json`: `"test:e2e": "pnpm --filter @md-coeditor/obsidian build && pnpm --filter @md-coeditor/e2e test:e2e"`. Both steps are Node programs, with no shell syntax beyond `&&`, which works in pnpm on Windows too.
- `packages/e2e/package.json`: `"test:e2e": "wdio run wdio.conf.mts"`.
- vitest: the e2e files end in `.e2e.ts`, so vitest's default pattern does not find them. Also add `packages/e2e` to no vitest project: the root `projects` glob `packages/*` finds it, so the package gets a `vitest.config.ts` with `include: []` and `passWithNoTests` (or the root config excludes it). Choose the simpler way in task 1.
- `typecheck`: `tsc -p . --noEmit` checks the config, the helpers and the tests.
- Biome checks the package. The fixture vault notes are `.md`, so Biome ignores them already. The `.obsidian/*.json` files follow Biome formatting.

### D8. Platform rules

- Paths with `node:path` only. No shell commands in helpers.
- Keys through `modKey()` only.
- No headless flags in the config. On Linux, CI will add xvfb later, outside the config.
- The roadmap gets the open check "e2e tests run on Windows". Linux runs in Docker (D9). Change 12 does not close the open Windows check of change 2.

### D9. Linux in Docker, for runs without a window

Added during apply, on the user's request. Obsidian is an Electron app and has no headless mode. On macOS, a local run opens windows that take the keyboard focus (keys typed during a run went into the test notes in task 7.2's first tries).

- `packages/e2e/docker/Dockerfile`: `node:24-bookworm`, `xvfb` and the libraries that Electron needs, pnpm through corepack. It copies the repo (without `node_modules`, `dist`, the cache and `.git`, see `.dockerignore`), runs `pnpm install --frozen-lockfile` in the image (native packages for Linux), and runs as the non-root user `node`.
- Layer order: first the `package.json` files, the lockfile and the workspace file, then `pnpm install`, then the source. A change in the source does not reinstall.
- `scripts/e2e-docker.mjs` (root script `pnpm test:e2e:docker`): `docker build`, then `docker run --rm` with a named volume for `packages/e2e/.obsidian-cache` (Obsidian downloads once) and `--shm-size=1g` (Chromium needs more than the 64 MB default). Inside: `xvfb-run -a pnpm test:e2e`. Node `child_process.spawn` without a shell, so it works the same on macOS, Windows and Linux hosts.
- The image architecture is the host's (arm64 on Apple silicon, x64 on Intel and most Windows machines). Obsidian has Linux builds for both. The launcher adds `--no-sandbox` on Linux.
- The macOS run stays: it tests the real platform (Cmd key, macOS Electron). Run it before an archive. The Docker run is for every day and for agents.

Alternatives: a macOS VM (real platform, but large and slow); hiding the window after launch (not tested: macOS can slow down hidden windows, and the window still takes the focus at start).

### D10. E2E tests are the strong default for plugin behaviour

Added during apply, on the user's request.

- `openspec/config.yaml` rules: a design for a change that touches `packages/obsidian` or the Claude session lists the scenarios that need the real app; tasks add an e2e test for each of them (named after the scenario), with the vitest `test.todo` pointer; a task runs `pnpm test:e2e:docker`.
- `CLAUDE.md`: a short "Testing" section for agents that write tests.
- `openspec/docs/testing.md`: the full rules.
- "Strong default", not "must": a scenario that cannot be tested end-to-end (for example colours) stays manual, and the design says why.

## Risks / Trade-offs

- [Type checks: the wdio and mocha type packages may not work with TypeScript 7 (`tsc` 7)] → Task 1 is a spike: install, write the config and one empty test, run `typecheck` and `test:e2e`. If types fail, use `skipLibCheck` (already on) or a narrower `types` list. If the config file cannot load, use `wdio.conf.mjs` with JSDoc types.
- [Flaky tests: timing in a real app] → Wait for conditions, never for fixed times. Reset the vault between tests. Run the full suite three times in a row before archive.
- [The first run downloads Obsidian (about 100 to 200 MB)] → Cache folder, ignored by git. Write it in `tech-stack.md`.
- [Obsidian windows take focus on the desktop during the run] → Accepted for local macOS runs. Write it in `tech-stack.md` and `testing.md`. `pnpm test:e2e:docker` (D9) runs without a window.
- [Docker: the Linux app behaves differently from macOS (fonts, Ctrl key, menus)] → The tests use `modKey()`, DOM menus and no pixel checks. The macOS run stays before each archive.
- [Docker: the first build downloads the base image and installs all packages (several minutes)] → Layer cache and a named volume for the Obsidian cache.
- [The installer version must run app 1.14.4] → Choose it in task 1 and check it with one run.
- [`resetVault` does not reset app config] → Tests do not change the config. A test that must change it uses `reloadObsidian()`.
- [DOM menus are not native menus] → The plugin adds items to Obsidian's `Menu` object in both cases. The native display is Obsidian's code, not ours. A short manual check with native menus stays in the manual list.
- [Hover tooltips may depend on the mouse position and a delay] → Move to the span, wait for `.tooltip`, compare its text. If it is too unstable, test the `aria-label` in the real DOM and keep the display manual. Record this in the test. Found in task 3.2: Obsidian shows an `aria-label` tooltip only after two or more mouse `pointermove` events (a guard against touch input). One WebDriver move is one event, so `tooltipOf` moves the pointer in small steps. With that, the real `.tooltip` shows in each run, and no `aria-label` fallback is necessary.

## Tests

- **Levels:** vitest and jsdom stay the main test level (`pnpm check`). The e2e tests in the real app are the second level: `pnpm test:e2e:docker` (Linux, no window) after changes in `packages/obsidian`, and `pnpm test:e2e` (macOS) before an archive.
- **Tools:** WebdriverIO, wdio-obsidian-service, mocha, wdio-obsidian-reporter.
- **Spike first:** one empty e2e test that opens the fixture vault and checks that the plugin is loaded (`app.plugins.plugins["md-coeditor"]`). This shows that the toolchain works before any real test.
- **Stability check:** run the full suite three times in a row with no failure.
- **Mutation check:** break one thing in the plugin on purpose (for example, remove the `motion.ts` keymap). Check that the matching e2e test fails, then undo the break.
- **Manual checks that stay:** colours, light and dark theme, hotkeys set by the user, the native macOS menu (one look), Windows (open check).
