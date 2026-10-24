# Tasks

## 1. Package setup

- [x] 1.1 Add `fast-check` to the `catalog:` in `pnpm-workspace.yaml` (version from `npm view fast-check version`) and as a dev dependency `"catalog:"` of `packages/format`. Add `packages/format/vitest.config.ts` (`defineProject`, name `format`, environment `node`, as in `packages/bridge`). Add `test/` to the `include` of `packages/format/tsconfig.json`. Verify that `pnpm install` succeeds and that `pnpm test` lists the `format` project
- [x] 1.2 Add `src/types.ts` with `Mark`, `Zone`, `Segment`, `ParsedNote`, `Result<T>` and the error codes (design D1, D6, D7, D8). Verify that `pnpm typecheck` passes
- [x] 1.3 Add the `fast-check` entry to `openspec/docs/tech-stack.md` (Tests row: property tests in `packages/format`). Verify that the docs name the same version range as the catalog

## 2. Block zones

- [x] 2.1 Implement `src/zones.ts` (design D3, pass 1): frontmatter, fenced code (also unclosed), indented code (not after a list item), tables. LF and CRLF. Add `test/zones.test.ts` with at least one positive and one negative case per zone kind, plus CRLF and an unclosed fence. Verify that the tests pass

## 3. Parse and serialize

- [x] 3.1 Implement `src/attrs.ts` (design D4): read an attribute prefix with its exact range, write a prefix in the order `id`, `author`, `date` and then other attributes. Add `test/attrs.test.ts` (valid prefix, unknown attribute kept in order, unclosed quote, line break in value, spaces before the operator). Verify that the tests pass
- [x] 3.2 Implement `src/parse.ts` (design D3 pass 2, D4): left-to-right scan outside block zones, inline code versus marks (first construct wins), the five kinds, first close sequence wins, no blank line in a mark, no crossing of block zones, duplicate ids. Implement `src/serialize.ts` (`serialize`, `writeMark`). Add `test/parse.test.ts`. Verify that the tests pass
- [x] 3.3 Add `test/markup-format.spec.test.ts` with one test per scenario of the requirements "Recognize the five mark kinds", "Mark attributes", "Lossless round trip", "Positions in UTF-16 code units" and "Protected zones" in `specs/markup-format/spec.md`. Use the scenario names as test names. Verify that the tests pass
- [x] 3.4 Add `test/roundtrip.property.test.ts` with `fast-check`: random text from markup fragments, attribute prefixes, backticks, fences, `|`, `---`, CRLF and emoji. Check `serialize(parse(t)) === t`, and that marks and zones do not overlap and are in order. Verify that the test passes with at least 1000 runs

## 4. Ids

- [x] 4.1 Implement `src/ids.ts` (design D5): `newId` (6 characters `[a-z0-9]`, injectable), `assignIds` (new id for marks without one and for each duplicate after the first, change only the prefix). Add `test/ids.test.ts` and the spec tests for the requirement "Unique mark ids". Add a property test: after `assignIds`, all ids are unique, and the text outside mark prefixes is the same. Verify that the tests pass

## 5. Suggest

- [x] 5.1 Implement `src/suggest.ts` (design D6): input checks, search over plain-text places with `before` and `after`, refusal reasons, trim to whole words, block-prefix check, write deletion then insertion with new ids. Add `test/suggest.test.ts` (overlapping matches, context at the start and end of the note, prefix rules for headings, lists, tasks, quotes and indentation, a change of one letter, trailing and leading whitespace). Verify that the tests pass
- [x] 5.2 Add the spec tests for the requirements "Suggestion makes insertion and deletion marks", "Suggestion target must be unique" and "Unsafe suggestions are refused" to `test/markup-format.spec.test.ts`. Use a counter `newId` so that the expected text is exact. Verify that every scenario of `specs/markup-format/spec.md` has a test and that they pass

## 6. Decisions

- [x] 6.1 Implement `src/decide.ts` (design D7): find by id, refusals `not_found`, `duplicate_id` and `unsupported_kind`, replace the full mark range, report the mark, the decision and the replacement. Add `test/decide.test.ts` (attributes are removed with the mark, CRLF, a mark at the start and at the end of the note). Verify that the tests pass
- [x] 6.2 Add `test/change-decisions.spec.test.ts` with one test per scenario in `specs/change-decisions/spec.md`. Verify that the tests pass
- [x] 6.3 Add property tests: after a successful suggest, rejecting all new marks gives the original text, and accepting all new marks gives the text with `find` replaced by `replace`. Verify that the tests pass with at least 1000 runs

## 7. Public API and integration check

- [x] 7.1 Export `parse`, `serialize`, `suggest`, `decide`, `assignIds`, `newId` and the public types from `src/index.ts`, with a short TSDoc comment on each function. Verify that a test imports them from `@md-coeditor/format` (the package name, not a relative path)
- [x] 7.2 Run `pnpm check` and `pnpm build` at the repo root. Verify that both exit with code 0, and that `packages/format/src` imports nothing from `obsidian`, `@codemirror/*` or `node:*` (search the source)

## 8. Review fixes

From the architect review and the test review after the first apply. Design D1, D3, D6 to D9 and the specs are updated.

- [x] 8.1 Add the type `Change = { from, to, insert }` and the error code `unsafe_result` to `src/types.ts`. `suggest`, `decide` and `assignIds` return `changes` (positions in the input text, in order, no overlap) and `text`. `decide` no longer returns `replacement`. Update the existing tests, and add a test for each function that applying `changes` to the input gives `text`. Verify that the tests pass
- [x] 8.2 Implement `src/project.ts` (design D1): `project(text)` gives the agent view text and, for each mark, its range in the view, with a function that maps a view position to a note position. Add `test/project.test.ts` and the spec tests for the requirement "Agent view". Verify that the tests pass
- [x] 8.3 Change the search in `src/suggest.ts` to the agent view (design D6 steps 2 and 3): `before` and `after` in the view, zone matches do not count, matches that touch a mark count for `ambiguous`, one match that overlaps a mark gives `overlaps_mark`, matches and the trim (step 4) never split a surrogate pair. Remove the old fallback search. Add the spec tests for the new scenarios of "Suggestion target must be unique" and "Change an emoji". Verify that the tests pass
- [x] 8.4 Implement the outcome check (design D6 step 7) in `src/suggest.ts`: parse the marked text and every decision outcome, compare marks, zones and the block prefix, and refuse with `structural_edit` or `unsafe_result`. `markup_in_text` is then only for bad input. Add the spec tests for the requirement "Decision outcomes stay safe", and unit tests for: replace text `|---|` under a line with `|`, replace text `---` on line 1 with a later `---` line, replace text `===`, and replace text `{a="1"` before `++z++}`. Verify that the tests pass
- [x] 8.5 Skip a leading byte order mark for the frontmatter test in `src/zones.ts` (design D3). Add the spec test "Frontmatter after a byte order mark" and a CRLF frontmatter test. Verify that the tests pass
- [x] 8.6 Fix the close-search cache in `src/parse.ts`: it can return a stale result when an attribute prefix moves the search start forward and the mark then fails. Add a test: `{a="{++b++}" ++c` has the insertion `{++b++}` at 4 to 11. Verify that the tests pass
- [x] 8.7 Make the tests stronger, as the test review found (design D9). Each item gets a test that fails on the named wrong implementation:
  - the rules for matches in marks and zones (design D6 step 3): `` `cat` and cat `` with the find text `cat` changes the second `cat` (zone matches do not count); `a cat {++cat++}` with the find text `cat` is `ambiguous` (matches in a mark count); `a {++big cat++}` with the find text `cat` is `overlaps_mark` (one match, inside a mark)
  - all 11 markup sequences, in `find` and in `replace` (table test)
  - block-prefix markers: `+ item`, `1) item`, a tab, `- [x] done`, and `####### x` (seven `#` is text, so the edit is allowed)
  - attribute checks: author with a line break, date `2026-10-24T` (both `invalid_attribute`), and `{a1="x"++y++}` parses
  - zone edges: a fence with 3 spaces of indentation, `---x` is not frontmatter, the delimiter row `|:-:|--:|`, a whitespace-only line before indented code and after a table, `- item` then `  more`, a blank line and `    code` is not code, a zone after non-ASCII text has the right positions, a match directly next to a zone
  - refusal order: `overlaps_mark` wins over `protected_zone`
  - every error code has a test, and every `message` is not empty
  - ids: a `newId` that returns `x`, `x`, `y` gives the deletion `x` and the insertion `y`; many default ids together use all 36 characters
  - exact expected text instead of `ok`, `startsWith`, `endsWith` or `toContain` in the spec tests "Single line break in a mark", "Unknown attribute is kept" (also the attribute order), "Only a deletion", "Not found" (also no `text`, and a `message`), "Context makes it unique", "Next to a pending mark", "Heading text can change", and in `test/suggest.test.ts`
  - "Unsupported kind" in `test/change-decisions.spec.test.ts`: compare with the input, not with itself; "Result of an accepted insertion": also check `date`, `end` and `changes`
  - remove the wall-clock limit from the performance test in `test/parse.test.ts` (keep the input, check the result)

  Verify that the tests pass, and that each listed wrong implementation makes at least one test fail (try a few by hand)
- [x] 8.8 Make the property tests stronger (design D9): the suggest/decide generators include pending marks, zones, CRLF, emoji, indentation and `before`/`after`; at least 30% of the runs succeed, with insertion-only and deletion-only cases. Check the reported marks (position, id, author, date) and that `changes` gives `text`. Add the property: after a successful suggest, every decision outcome leaves the other marks and the zones as they were. Add CRLF, emoji and block zones to the `assignIds` generator, and frontmatter and tables to the round-trip generator. Verify that the tests pass with at least 1000 runs each
- [x] 8.9 Export `project` and the types `View` and `Change` from `src/index.ts`, with a short TSDoc comment. Run `pnpm check` and `pnpm build` at the repo root. Verify that both exit with code 0, and that `packages/format/src` imports nothing from `obsidian`, `@codemirror/*` or `node:*`
- [x] 8.10 Update `openspec/docs/roadmap.md`. Add follow-ups: error details (match count, zone kind) and one error union per function; a readonly, discriminated `Mark` type and a decision about `serialize`; zones for backslash escapes, `[[wikilinks]]` and callout markers; CJK word boundaries; `decideMany`; API consistency (`decide` arguments, `Result` key collisions, calendar check of `date`); `coedit-cli` bundle tests for no arguments and an unknown option, and a check that the bundle is not stale. Add the open check: dialect compatibility with existing Obsidian CriticMarkup plugins (design Open Questions). Verify that each item names the change or check where it belongs

## Workflow follow-up

- Before archive: copy lasting decisions from `design.md` into `openspec/docs/` (for example a new section in `architecture.md` for the mark dialect with the HTML-comment alternative, zones, ids, the agent view and the outcome check), as the rule in `openspec/config.yaml` says.
- Archive the change. This creates `openspec/specs/markup-format/spec.md` and `openspec/specs/change-decisions/spec.md`.
- Update `handover.md`, then propose change 2, `add-obsidian-review-basics`.
