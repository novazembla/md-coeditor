# Tasks

## 1. Package setup

- [ ] 1.1 Add `fast-check` to the `catalog:` in `pnpm-workspace.yaml` (version from `npm view fast-check version`) and as a dev dependency `"catalog:"` of `packages/format`. Add `packages/format/vitest.config.ts` (`defineProject`, name `format`, environment `node`, as in `packages/bridge`). Add `test/` to the `include` of `packages/format/tsconfig.json`. Verify that `pnpm install` succeeds and that `pnpm test` lists the `format` project
- [ ] 1.2 Add `src/types.ts` with `Mark`, `Zone`, `Segment`, `ParsedNote`, `Result<T>` and the error codes (design D1, D6, D7, D8). Verify that `pnpm typecheck` passes
- [ ] 1.3 Add the `fast-check` entry to `openspec/docs/tech-stack.md` (Tests row: property tests in `packages/format`). Verify that the docs name the same version range as the catalog

## 2. Block zones

- [ ] 2.1 Implement `src/zones.ts` (design D3, pass 1): frontmatter, fenced code (also unclosed), indented code (not after a list item), tables. LF and CRLF. Add `test/zones.test.ts` with at least one positive and one negative case per zone kind, plus CRLF and an unclosed fence. Verify that the tests pass

## 3. Parse and serialize

- [ ] 3.1 Implement `src/attrs.ts` (design D4): read an attribute prefix with its exact range, write a prefix in the order `id`, `author`, `date` and then other attributes. Add `test/attrs.test.ts` (valid prefix, unknown attribute kept in order, unclosed quote, line break in value, spaces before the operator). Verify that the tests pass
- [ ] 3.2 Implement `src/parse.ts` (design D3 pass 2, D4): left-to-right scan outside block zones, inline code versus marks (first construct wins), the five kinds, first close sequence wins, no blank line in a mark, no crossing of block zones, duplicate ids. Implement `src/serialize.ts` (`serialize`, `writeMark`). Add `test/parse.test.ts`. Verify that the tests pass
- [ ] 3.3 Add `test/markup-format.spec.test.ts` with one test per scenario of the requirements "Recognize the five mark kinds", "Mark attributes", "Lossless round trip", "Positions in UTF-16 code units" and "Protected zones" in `specs/markup-format/spec.md`. Use the scenario names as test names. Verify that the tests pass
- [ ] 3.4 Add `test/roundtrip.property.test.ts` with `fast-check`: random text from markup fragments, attribute prefixes, backticks, fences, `|`, `---`, CRLF and emoji. Check `serialize(parse(t)) === t`, and that marks and zones do not overlap and are in order. Verify that the test passes with at least 1000 runs

## 4. Ids

- [ ] 4.1 Implement `src/ids.ts` (design D5): `newId` (6 characters `[a-z0-9]`, injectable), `assignIds` (new id for marks without one and for each duplicate after the first, change only the prefix). Add `test/ids.test.ts` and the spec tests for the requirement "Unique mark ids". Add a property test: after `assignIds`, all ids are unique, and the text outside mark prefixes is the same. Verify that the tests pass

## 5. Suggest

- [ ] 5.1 Implement `src/suggest.ts` (design D6): input checks, search over plain-text places with `before` and `after`, refusal reasons, trim to whole words, block-prefix check, write deletion then insertion with new ids. Add `test/suggest.test.ts` (overlapping matches, context at the start and end of the note, prefix rules for headings, lists, tasks, quotes and indentation, a change of one letter, trailing and leading whitespace). Verify that the tests pass
- [ ] 5.2 Add the spec tests for the requirements "Suggestion makes insertion and deletion marks", "Suggestion target must be unique" and "Unsafe suggestions are refused" to `test/markup-format.spec.test.ts`. Use a counter `newId` so that the expected text is exact. Verify that every scenario of `specs/markup-format/spec.md` has a test and that they pass

## 6. Decisions

- [ ] 6.1 Implement `src/decide.ts` (design D7): find by id, refusals `not_found`, `duplicate_id` and `unsupported_kind`, replace the full mark range, report the mark, the decision and the replacement. Add `test/decide.test.ts` (attributes are removed with the mark, CRLF, a mark at the start and at the end of the note). Verify that the tests pass
- [ ] 6.2 Add `test/change-decisions.spec.test.ts` with one test per scenario in `specs/change-decisions/spec.md`. Verify that the tests pass
- [ ] 6.3 Add property tests: after a successful suggest, rejecting all new marks gives the original text, and accepting all new marks gives the text with `find` replaced by `replace`. Verify that the tests pass with at least 1000 runs

## 7. Public API and integration check

- [ ] 7.1 Export `parse`, `serialize`, `suggest`, `decide`, `assignIds`, `newId` and the public types from `src/index.ts`, with a short TSDoc comment on each function. Verify that a test imports them from `@md-coeditor/format` (the package name, not a relative path)
- [ ] 7.2 Run `pnpm check` and `pnpm build` at the repo root. Verify that both exit with code 0, and that `packages/format/src` imports nothing from `obsidian`, `@codemirror/*` or `node:*` (search the source)

## Workflow follow-up

- Before archive: copy lasting decisions from `design.md` into `openspec/docs/` (for example a new section in `architecture.md` for the mark dialect, zones and ids), as the rule in `openspec/config.yaml` says.
- Archive the change. This creates `openspec/specs/markup-format/spec.md` and `openspec/specs/change-decisions/spec.md`.
- Update `handover.md`, then propose change 2, `add-obsidian-review-basics`.
