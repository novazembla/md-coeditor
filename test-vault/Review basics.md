---
title: Review basics
note: "Not tracked in frontmatter: {++x++}"
---

# Review basics

Manual test note for the change `add-obsidian-review-basics`. Open it in Live Preview, Source mode and Reading view. Opening the note must not change the file (check with `git diff`).

## Insertions

The {id="a1" author="Claude" date="2026-10-24"++big ++}cat sat on the mat.

The {++small ++}dog has no attributes.

## Deletions

A {id="d1" author="Claude" date="2026-10-24"--very --}big cat.

## A replace

The dog sat.

## Marks without ids

{++First++} and {++second++} have no id. Accept the first: the second must stay as it is.

## A duplicate id

{id="dup1"++one++} and {id="dup1"++two++} have the same id. Reject the second.

## Marks in code and in a table

Inline code: `{++not a mark++}` stays raw.

```
{++not a mark in a code block++}
```

| Column | Value |
|---|---|
| a | {++not a mark in a table++} |

## A substitution

A {~~cat~>dog~~} sat. Accept and reject show "Not supported yet: substitution."

Also a {==highlight==} and a {>>comment<<}.

## A mark over two lines

{id="a3" author="Claude"++one
two++} end

## Underscore and star in attribute values

The {id="a4" author="my_name_here"++first++} word, and {id="a5" author="*star*"++second++} word.

## Formatting inside a mark

A {id="a6" author="Claude"++**bold** idea++}.
