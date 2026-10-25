# Testing

Status: accepted on 2026-10-24. Change 12 (`add-obsidian-e2e-tests`) adds the end-to-end level.

This document tells how the project is tested: the test levels, the tools, the commands, and the rules for each level. The tool choices are also in [tech-stack.md](tech-stack.md).

## Test levels

| Level | Tool | Where | Command | When |
|---|---|---|---|---|
| Unit and spec tests | vitest (jsdom for CodeMirror 6, `fast-check` for property tests) | `packages/*/src/**/*.test.ts`, `packages/*/test/**/*.test.ts`, `adapters/*/test/**/*.test.ts`, `scripts/**/*.test.mjs` | `pnpm test` (also in `pnpm check`) | On each change. Fast, no display. |
| End-to-end tests | WebdriverIO + mocha + `wdio-obsidian-service`, in the real Obsidian app | `packages/e2e/tests/*.e2e.ts` | `pnpm test:e2e:docker` (Linux, no window), `pnpm test:e2e` (macOS) | Docker: after each change in `packages/obsidian`. macOS: before an archive. Not in `pnpm check`. |
| Manual checks | the developer, in `test-vault/` | `openspec/changes/<change>/tasks.md` | — | Only for what the two levels above cannot check (see "Manual checks"). |

vitest stays the main level. jsdom has no layout and no Obsidian, so behaviour that needs the real app (cursor motion over hidden syntax, the right-click menu, the command palette, notices, Reading view, Source mode, file reload, hover tooltips) is tested end-to-end.

## When a change must add e2e tests

E2E tests are the strong default for plugin behaviour. A change that touches `packages/obsidian`, or what the user sees or does in Obsidian:

1. lists in its design (Tests section) the scenarios that need the real app;
2. adds an e2e test for each of them, named after the scenario, and changes the vitest `test.todo` to a pointer;
3. runs `pnpm test:e2e:docker` (all tests pass), and before the archive `pnpm test:e2e` on macOS;
4. checks each new e2e test once by breaking the plugin on purpose (see "Mutation check").

A scenario that cannot be tested end-to-end (for example colours) stays manual, and the design says why. The OpenSpec rules in `openspec/config.yaml` and the "Testing" section in `CLAUDE.md` say the same for agents.

## Spec scenarios and test names

- A spec scenario has one test with the same name. A search for the scenario name finds the spec, the vitest test and the e2e test.
- vitest: one `*.spec.test.ts` file per capability (for example `packages/obsidian/src/markup-rendering.spec.test.ts`). The `describe` name is the requirement.
- e2e: the `describe` name is the capability (`markup-rendering`, `change-decisions`), the `it` name is the scenario name, exactly as in the spec.
- When a scenario is tested end-to-end, the vitest file keeps a `test.todo` with a pointer: `"<scenario>: e2e in packages/e2e/tests/<file>.e2e.ts"`. vitest then shows that it is covered elsewhere, and `pnpm check` does not need Obsidian.
- Tests that are not spec scenarios (regression tests, undo tests) have names that say what they check.

## Unit and spec tests (vitest)

- The root `vitest.config.ts` makes each folder in `packages/*` and `adapters/*` a vitest project, plus a `scripts` project. `packages/e2e` is excluded (`"!packages/e2e"`).
- `packages/obsidian` uses jsdom. The CodeMirror 6 logic gets `isLivePreview` as an injected function, because the `obsidian` package has no runtime code.
- `pnpm check` runs lint, type checks and vitest. It never starts Obsidian.

## End-to-end tests

### How it works

`wdio-obsidian-service` downloads a pinned Obsidian version, copies the fixture vault `packages/e2e/vault/` to a temporary sandbox, installs the plugin build from `packages/obsidian/dist`, enables it, and starts Obsidian. WebdriverIO drives the app through the Electron chromedriver. The log says `chrome(…)`: that is the Chromium inside Electron, not Google Chrome. The window is the real Obsidian app.

```
packages/e2e/
├── package.json        @md-coeditor/e2e, private; scripts test:e2e, typecheck
├── tsconfig.json       wdio, mocha and service types
├── wdio.conf.mts       version pins, vault, plugin folder, shared beforeTest hook
├── vault/              fixture vault (copied to a sandbox for each run)
├── helpers/            keys, editor, files, menu, palette, notices, hover, reset, bridge
├── tests/*.e2e.ts      one file per area
└── .obsidian-cache/    downloaded Obsidian versions (ignored by git)
```

### Commands

| Command | What it does |
|---|---|
| `pnpm test:e2e:docker` | Runs all e2e tests in Linux in Docker, with a virtual display. No window opens. The default for every day and for agents. |
| `pnpm test:e2e:docker --spec tests/cursor.e2e.ts` | Runs one test file in Docker. Extra arguments go to wdio. |
| `pnpm test:e2e` | Builds the plugin and the bridge (`coedit`), then runs all e2e tests on this machine (macOS: opens windows). |
| `pnpm --filter @md-coeditor/e2e test:e2e` | Runs the e2e tests with the current plugin build (no build). |
| `pnpm --filter @md-coeditor/e2e exec wdio run wdio.conf.mts --spec tests/cursor.e2e.ts` | Runs one test file. |
| `pnpm --filter @md-coeditor/e2e typecheck` | Type checks the config, the helpers and the tests (also in `pnpm typecheck`). |

The first run downloads Obsidian (about 100 to 200 MB) to `packages/e2e/.obsidian-cache/`. Later runs use the cache. A full run takes about half a minute to a minute and a half.

### A local run takes the desktop

- There is no headless mode. Obsidian is an Electron app and needs a display. On macOS and Windows, `pnpm test:e2e` opens Obsidian windows.
- The windows take the keyboard focus. **Do not type during a local run.** Keys that you type go into the test note and make tests fail (seen during change 12: letters such as `o` in the note text).
- One Obsidian window runs at a time (`maxInstances: 1`).
- To work while the tests run, use `pnpm test:e2e:docker`.

### Linux in Docker

`pnpm test:e2e:docker` (`scripts/e2e-docker.mjs`) builds the image `md-coeditor-e2e` from `packages/e2e/docker/Dockerfile`, then runs `xvfb-run -a pnpm test:e2e` in a container. xvfb is a virtual display: Obsidian runs as on a real screen, but nothing shows on the desktop.

- **Needs** a running Docker engine (for example Docker Desktop). The script uses Node `spawn` without a shell, so it works on macOS, Windows and Linux hosts.
- **Image:** `node:24-bookworm`, xvfb, the Electron libraries, pnpm 12.15.0. The repo is copied into the image (`.dockerignore` leaves out `node_modules`, `dist`, the cache, `.git`), and `pnpm install --frozen-lockfile` runs in the image, so native packages are for Linux. The install layer has only the manifests and the lockfile: a source change does not reinstall. The container runs as the user `node`.
- **Cache:** the named volume `md-coeditor-e2e-obsidian-cache` keeps the Obsidian downloads. Remove it with `docker volume rm md-coeditor-e2e-obsidian-cache`.
- **Architecture:** the host's (arm64 on Apple silicon, x64 on Intel). Obsidian has Linux builds for both. The launcher adds `--no-sandbox` on Linux.
- **Speed:** the first build takes a few minutes. Later runs take about 20 seconds (on Apple silicon), faster than on macOS, because Obsidian starts faster and no window is drawn.
- **What it does not test:** the macOS platform (Cmd key, macOS Electron, fonts). So the macOS run stays before each archive.

### Version pins

| Setting | Value | Why |
|---|---|---|
| App version | `minAppVersion` from `packages/obsidian/manifest.json` (now 1.14.4) | The tests run on the oldest version that the plugin supports. When `minAppVersion` changes, the e2e version changes with it. The config reads the manifest itself, because the service's `"earliest"` looks for `manifest.json` only in the parent folders of the working folder. |
| Installer version | `1.14.4` (Electron 43.7.7) | The installer brings Electron. A new installer can change behaviour with the same app version. App 1.14.4 runs with installers 1.5.8 to 1.14.4; 1.14.4 is the newest. |
| wdio | 9 | `wdio-obsidian-service` 3.3 needs `webdriverio` ^9. |
| Builds | `classic-level: true`, `edgedriver: false`, `geckodriver: false` in `allowBuilds` | The service needs the native `classic-level`. Obsidian uses the Electron chromedriver, so the Edge and Firefox drivers are not needed. |

No beta versions: they need an Obsidian Insiders account. No `"latest"`: the tests would then change without a change in the repo.

### Fixture vault

- `vault/.obsidian/app.json` fixes the settings that change editor behaviour: `nativeMenus: false` (DOM menus), `livePreview: true`, no Vim mode, no auto-pair, no spellcheck. `appearance.json` fixes the theme (light).
- One note for each test area: `cursor.md`, `hover.md`, `decisions.md`, `undo.md`, `modes.md`, `reload.md`, `no-changes.md`, `smoke.md`. The folder `agent/` (`essay.md`, `plan.md`, `review.md`, `drafts/draft.md`) is for the agent tests (hub, tools, log, loop). Each note holds only the text its tests need. The exact text is also a constant in the test, so a failed test shows the expected text.
- `test-vault/` is for manual tests only. The e2e tests do not use it.

### Shared hook

`beforeTest` in `wdio.conf.mts` calls `resetVault()` before each test: it closes menus and modals with Escape, closes all notes (so the undo history is fresh), puts the vault notes back (`obsidianPage.resetVault()`), and removes notices. `obsidianPage.resetVault()` deletes every file that is not in the fixture vault, also dot folders, so the helper hides `.coedit/` from it: the endpoint, the log and the cursors stay while the plugin runs. A test that checks the log reads the last `seq` first (`lastSeq()`) and looks only at the events after it. Tests do not change the app config. A test that must change it uses `browser.reloadObsidian()`.

### Helpers

| Helper | Does |
|---|---|
| `modKey()` | `Key.Command` on macOS, `Key.Control` on Windows and Linux. |
| `openNote(path, mode)` | Opens a note in `live`, `source` or `reading`, and waits until the view is ready. |
| `at(doc, place)` | The offset of a place: a number, `{ before: text }` or `{ after: text }`. Offsets do not appear in the tests. |
| `setCursor(offset)`, `cursor()` | Set or read the cursor through Obsidian's `Editor` API. |
| `docText()`, `fileText(path)` | The editor text; the file text on disk (saves the open note first). |
| `renderedLine(n)` | The visible text and the styled parts (class, theme colour, text decoration) of editor line `n` or Reading view paragraph `n`. |
| `rightClickOn(target)`, `menuItems()`, `clickMenuItem(title)`, `closeMenu()` | Right-click on a selector or on a text in the editor; read and click DOM menu items. `rightClickOn` returns when the page has handled the `contextmenu` event. `menuItems({ optional: true })` returns `[]` when no menu opened. |
| `paletteItems(query)`, `runFromPalette(title)` | Read the command palette suggestions as `"MD-Coeditor: Accept change"`; run a command from the palette. |
| `notices()`, `waitForNotice(text)` | The visible notices; wait for one. |
| `tooltipOf(selector)` | Move the mouse to an element and read the Obsidian tooltip. |
| `writeOnDisk(path, text)` | Write a note with Node `fs` in the sandbox, so Obsidian sees a change from outside. |
| `startBridge()`, `runInbox()` | Start `coedit mcp` (bundle `packages/bridge/dist/coedit.mjs`) for the sandbox vault with an MCP client; run `coedit inbox --digest --mark-read` with hook JSON on stdin. `COEDIT_SESSION` is `e2e-run`; `CLAUDE_CODE_SESSION_ID` and the hook `session_id` differ, so the tests show that the launcher session wins. |
| `readEndpoint()`, `logEvents()`, `lastSeq()`, `waitForEvents(seq, n)`, `restartPlugin()` | Read `endpoint.json` and the log in the machine folder; switch the plugin off and on. |
| `waitFor(get, ok, what)` | Wait for a condition, with a short timeout and the last value in the error. |

### Rules

- Name tests after the spec scenarios (see above).
- Use `modKey()` for Cmd or Ctrl. Tests never write `Meta` or `Control`.
- No fixed sleeps (`pause()`). Wait for a condition (`waitFor`, `waitUntil`, `waitForDisplayed`).
- DOM menus (`nativeMenus: false`). The plugin adds items to Obsidian's `Menu` object, which is the same for native menus. The native display is Obsidian's code.
- Paths with `node:path`. No shell commands in helpers or scripts.
- Obsidian internals that are not in the public types (for example `editor.cm`, `app.plugins`) only in helpers, with a comment.

### Things found about Obsidian

- Obsidian shows an `aria-label` tooltip only after two or more mouse `pointermove` events (a guard against touch input). One WebDriver move is one event, so `tooltipOf` moves the pointer in small steps.
- In Reading view, a right-click on text without a selection opens no menu.
- On macOS, a real right-click on text selects the word under the pointer. In Reading view, Obsidian then opens the native text menu (Look up, Copy), also with `nativeMenus: false`. The native menu blocks the app until it closes, and it stays on the screen after the test run (seen in change 3). So the Reading view test uses `rightClickOn({ selector, synthetic: true })`: a `contextmenu` event from the page, with no real click.
- In the editor, Obsidian stops the `contextmenu` event before it reaches the window, so `rightClickOn` listens in the capture phase.
- The command palette shows the plugin name in its own element (`.suggestion-prefix`).

### Mutation check

After a change to the e2e tests, break one thing in the plugin on purpose and check that the matching test fails. Example (change 12): remove `motionKeymap` from `coeditExtension`; the regression test for two key presses at a mark edge and "Arrow key over the hidden prefix" fail. Undo the break and rebuild.

## Manual checks

These stay manual:

- colours, light and dark theme (no screenshot or pixel tests);
- hotkeys that the user sets;
- one look at the native macOS menu (`nativeMenus` on);
- Windows (open check in [roadmap.md](roadmap.md)). Linux runs in Docker.
- the loop with a real `claude` login (tasks 12.3 to 12.5 of the change `add-claude-suggest-loop`). The e2e tests drive `coedit mcp` and `coedit inbox` with a scripted client (`helpers/bridge.ts`), so they never start `claude`. By hand, with a login, check:
  - `coedit claude` in a repo with a vault below it: the plugin is on, the five tools show, a suggestion arrives in Obsidian, and the next prompt gets the digest;
  - `/clear`, then a decision and a prompt: the digest comes once;
  - Ctrl+C during an agent turn: the session goes on and the plugin stays on;
  - `coedit claude --agent`: the profile runs;
  - a plain `claude` in the same folder: no co-editor tools, also with the plugin installed at user scope; whether `claude plugin install` switches the plugin on at user scope;
  - the deny rule from `coedit init` in `.claude/settings.json`: Claude Code blocks a direct Edit of a note;
  - `coedit claude -- --continue` and `-- --resume` (the digest uses the launcher's session), and `CLAUDE_CODE_MCP_ALLOWLIST_ENV=1` (the MCP server still gets `COEDIT_VAULT` and `COEDIT_SESSION`).
