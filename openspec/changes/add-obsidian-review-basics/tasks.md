# Tasks

## 1. Format library: dialect fixes and API clean-up

- [ ] 1.1 Change `readAttrs` in `packages/format/src/attrs.ts` (design D9): spaces and tabs between attributes, no `{` or `}` in a value. Make `suggest` refuse an author with `{` or `}` as `invalid_attribute`. Add rows to `test/attrs.test.ts` (tab, mixed tab and space, `{` in value, `}` in value). Verify that the tests pass and that the round-trip property test still passes with tabs added to its prefix generator
- [ ] 1.2 Add the calendar check for the `date` of `suggest` (design D9). Add a table test in `test/suggest.test.ts` with `2026-02-30`, `2026-02-29`, `2028-02-29`, `2026-13-01`, `2026-04-31` and `2026-10-24`. Verify that the tests pass
- [ ] 1.3 Replace `Mark` in `src/types.ts` with a readonly union, one shape per kind (design D9), and add the key constraint to `Result<T>`. Fix all uses in `packages/format`. Verify that `pnpm typecheck` passes and that a type test (`// @ts-expect-error`) shows that `oldContent` cannot be read on an insertion without a kind check
- [ ] 1.4 Change `decide` to take `{ text, id, decision }` (design D9). Update `test/decide.test.ts`, `test/change-decisions.spec.test.ts` and the property tests. Add the "check function" comment to `serialize`. Verify that `pnpm test` passes for the `format` project
- [ ] 1.5 Add `ensureId(text, at, options?)` in `src/ids.ts` and export it from `src/index.ts` (design D9). Add tests in `test/ids.test.ts` (no id, duplicate id, mark that already has a unique id: no change, other marks unchanged, `at` not at a mark start: programming error). Add a property test: `ensureId` changes only the prefix of one mark, and `ensureId` then `decide` gives the same text as `decide` on the same note where the mark had that id. Verify that the tests pass
- [ ] 1.6 Update `test/markup-format.spec.test.ts` with one test per scenario of the modified requirement "Mark attributes" and the new requirement "Suggestion date is a calendar date" in this change's `specs/markup-format/spec.md`. Use the scenario names as test names. Verify that the tests pass

## 2. Plugin setup

- [ ] 2.1 Add `@md-coeditor/format` (`workspace:*`) as a dependency of `packages/obsidian`, and `@codemirror/commands` as a devDependency in a version that works with the pinned `@codemirror/state` (catalog entry). Verify that `pnpm install` succeeds, that `pnpm build` makes `dist/main.js` with the format code bundled and no `@codemirror/commands` in it (search the bundle)

## 3. Marks field and rendering in Live Preview

- [ ] 3.1 Implement `src/marks.ts` (design D2): the state field with insertions and deletions outside protected zones, their hidden ranges, content ranges and attributes. Add `src/marks.test.ts` (one mark, a replace, a mark over two lines, a mark in inline code: not in the field, a substitution: not in the field, update after a document change). Verify that the tests pass
- [ ] 3.2 Implement `src/render.ts` and `src/extension.ts` with `coeditExtension({ isLivePreview })` (design D1, D2, D4): replace decorations, mark decorations with `coedit-ins` / `coedit-del` and `aria-label`, atomic ranges, nothing when `isLivePreview` is false. Add the classes to `styles.css` (design D3). Add `src/render.test.ts` with an `EditorView` in jsdom (visible text per line, classes, `aria-label` texts, atomic ranges, Source mode shows raw text). Verify that the tests pass

## 4. Keeping the syntax whole

- [ ] 4.1 Implement `src/protect.ts` (design D5): the change filter for user events and the Backspace/Delete keymap. Add `src/protect.test.ts`: Backspace before `big`, Delete after `big `, a selection over part of a mark (delete, type, paste), a selection over the whole mark, a non-user change (reload) over a mark, and the selection after each edit (design Open Questions). Verify that the tests pass

## 5. Decisions and navigation

- [ ] 5.1 Implement `src/decide.ts` (design D6): `markAt` with the rule for touching marks, `decideAt` with notices, `ensureId`, composed changes, one transaction with `filter: false`. Add `src/decide.test.ts` (accept and reject of both kinds, the two marks of a replace one after the other, no id, duplicate id, no mark, each unsupported kind, undo and redo with the history from `@codemirror/commands`). Verify that the tests pass
- [ ] 5.2 Implement `src/navigate.ts` (design D1): next and previous change with wrap-around, skip other kinds, the notice for a note without changes, the selection at `contentStart` with `scrollIntoView`. Add `src/navigate.test.ts`. Verify that the tests pass

## 6. Reading view

- [ ] 6.1 Implement `src/reading.ts` with `renderChanges(el)` (design D8). Add `src/reading.test.ts` with jsdom elements like Obsidian's rendered HTML: a replace in a paragraph, a mark around `strong`, a mark over a line break (`br`), mark syntax in `code`, in `pre` and in a `table` (unchanged), a substitution (unchanged), the `aria-label` texts. Verify that the tests pass

## 7. Obsidian wiring

- [ ] 7.1 Wire everything in `src/main.ts` (design D7): `registerEditorExtension` with `isLivePreview` from `editorLivePreviewField`, the four commands with `editorCheckCallback`, the `contextmenu` position field and the `editor-menu` items, `registerMarkdownPostProcessor` with `renderChanges`, `Notice` for the notice texts. Verify that `pnpm typecheck` and `pnpm build` pass and that `main.ts` has no logic beyond calls into the other modules (review the file)

## 8. Spec tests

- [ ] 8.1 Add `packages/obsidian/src/markup-rendering.spec.test.ts` with one test per scenario of this change's `specs/markup-rendering/spec.md`, named after the scenario. Scenarios that need the Obsidian app (hover tooltip display, right-click in Reading view, file reload from disk) are `test.todo` with a pointer to the manual test in group 11. Verify that every scenario has a test or a `test.todo` and that the tests pass
- [ ] 8.2 Add `packages/obsidian/src/change-decisions.spec.test.ts` with one test per scenario of this change's `specs/change-decisions/spec.md`, named after the scenario. The menu, command palette and notice display scenarios test the logic (`markAt`, `decideAt`, the `isLivePreview` check) and also have a `test.todo` for the app part. Verify that every scenario has a test and that the tests pass

## 9. Speed

- [ ] 9.1 Add a measurement script or vitest bench in `packages/obsidian` (not part of `pnpm check`) for design D10: a 1 MB note with 3,000 marks, the time for the field update and the decoration build. Run it and write the result into design.md (D10). Verify that the result is under 8 ms, or that a roadmap follow-up for an incremental parse exists

## 10. Docs

- [ ] 10.1 Update `openspec/docs/roadmap.md` (design D11): close the dialect open check, add the Commentator follow-up for change 9, add `markup-format` to change 2 in the slice section and in the Capabilities table, mark the follow-ups taken by change 2 as done, and set the status of change 2. Verify that the roadmap rows for change 2 match the proposal's Capabilities section
- [ ] 10.2 Update `openspec/docs/architecture.md` "Mark format" and "Open decisions" (design D11), and `openspec/docs/tech-stack.md` (injected `isLivePreview`, `@codemirror/commands` for tests only). Verify that no doc still calls the dialect an open decision (search for "dialect" in `openspec/docs/`, except `initial-plan.md`)

## 11. Integration and manual checks

- [ ] 11.1 Run `pnpm check`. Verify that lint, type checks and all tests pass
- [ ] 11.2 Add a manual test note `test-vault/Review basics.md` with all cases from the design Tests section (insertions, deletions, a replace, marks without ids, a duplicate id, marks in code and in a table, a substitution, a mark over two lines, `_` and `*` in attribute values, formatting inside a mark). Verify that the note opens in the test vault and that the file is unchanged on disk after opening (`git diff`)
- [ ] 11.3 Manual check in Obsidian, Live Preview: colours, hidden syntax with the cursor inside, arrow keys, Backspace and Delete at the edges, hover tooltips, light and dark theme. Verify that each item matches the spec `markup-rendering`
- [ ] 11.4 Manual check in Obsidian, decisions: the four commands from the palette and with user-set hotkeys, the right-click menu on a mark and on plain text, the notices, undo after accept and after reject, an id-less mark (the id never stays in the file after undo). Verify that each item matches the spec `change-decisions`
- [ ] 11.5 Manual check in Obsidian, other modes: Source mode (raw text, no commands in the palette), Reading view (styles, no menu items), a change of the file on disk while the note is open. Verify that each item matches the specs
- [ ] 11.6 Manual check on Windows by the user (roadmap open check): build, link, and repeat 11.3 to 11.5. Verify that the user reports the result, or record it as not done in the roadmap

## Workflow follow-up

- Before archive, copy lasting design decisions (D1 module split, D5 edit protection, D8 Reading view approach) into `openspec/docs/architecture.md`.
- Archive the change, then set its roadmap status to "archived" and update the "Main spec exists" column for `markup-rendering`.
