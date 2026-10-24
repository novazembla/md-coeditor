# Handover

Session notes for the next person or agent session. Keep this file short. Replace the notes at the end of each session.

- **Status, order and dependencies of all changes:** [openspec/docs/roadmap.md](openspec/docs/roadmap.md).
- **Lasting decisions:** [architecture.md](openspec/docs/architecture.md), [tech-stack.md](openspec/docs/tech-stack.md), [CLAUDE.md](CLAUDE.md).
- **Purpose and value:** [vision.md](openspec/docs/vision.md).
- The initial plan [initial-plan.md](openspec/docs/initial-plan.md) is frozen and partly old. When it disagrees with the other docs, the other docs win.

## Last session (2026-10-24)

- Applied and archived change 0, `setup-monorepo`. Its lasting decisions went into `openspec/docs/`.
- Specified change 1, `add-insert-delete-format`. User decisions for it:
  - Mark metadata uses the attribute prefix.
  - Protected zones: frontmatter, code (fenced, indented, inline) and tables.
  - The other CriticMarkup kinds are recognized and kept as they are.
- Moved the slice and change plan from this file into `openspec/docs/roadmap.md`. `openspec/config.yaml` now points agents to it (`context:`), and the apply and archive guidance keeps the status in it up to date.

## Not committed yet

- The archive of `setup-monorepo` and the docs updates.
- The new change `openspec/changes/add-insert-delete-format/`.
- `roadmap.md`, `vision.md`, `initial-plan.md` (moved from `~/.claude/plans/`), `config.yaml`, `CLAUDE.md`, `README.md` and this file.

Ask the user before you commit.

## Next steps

1. The user reviews `add-insert-delete-format` (most important: `design.md` and `tasks.md`).
2. Apply it with `/opsx:apply`. Then propose change 2, `add-obsidian-review-basics`.
3. Spikes S1 and S2 can start in parallel in `spikes/` at any time.

## Developer machine (observed 2026-10-24)

| Tool | Version | Note |
|---|---|---|
| Node | v24.9.0 | Development needs ≥ 24.15 (jsdom 30). Update it. |
| pnpm | 12.15.0 | |
| Claude Code | 2.1.310 | |
| Obsidian | 1.14.5 | |
| OpenSpec CLI | 1.15.0 | |

## Working preferences

- Simple language (ASD-STE100), extended with domain terms.
- Do not create claude.ai assets unless the user asks.
- Build incrementally: the smallest end-to-end slice first.
- Subagents: Sonnet for mechanical work, Opus for research and architecture (rule in `CLAUDE.md`).
- Do not mention Dropbox in docs.
- Windows support matters. The product must be usable in a company.
