# Vision

This file tells why MD-Coeditor exists, for whom, and what value it gives. It has no technical details. For the parts and how they connect, see [architecture.md](architecture.md). For the order of the work, see [roadmap.md](roadmap.md). The source of this file is the [initial plan](initial-plan.md).

## In one sentence

MD-Coeditor gives Word-like track changes for Markdown notes in Obsidian, so a person can write together with an AI agent and stay in full control of the text.

## The problem

People who write in Markdown notes now also write with AI agents. The current tools have these problems:

- **The agent changes the text directly.** The user must find and check each change after it happened. It is easy to lose the user's own words.
- **Suggestions get lost.** In an earlier tool, open suggestions were lost when the editor reloaded.
- **Changes are hidden.** They are shown in a sidebar, not in the text where the user reads.
- **The agent does not learn.** It does not know which suggestions the user accepted, changed or rejected, so it makes the same mistakes again.
- **The loop is slow.** Existing track-changes tools for Obsidian have no direct path from the user back to the agent. The agent checks for news only from time to time.

## Who it is for

- Writers and knowledge workers who keep their notes in Obsidian.
- People who use an interactive agent session (first: Claude Code) in a terminal next to their notes.
- Teams in a company: the product must work on company machines (macOS and Windows) and under company rules for AI tools.

## The value

- **A review model that people know.** Accept, reject, comment, as in Word. No new way of working to learn.
- **The user stays in control.** The agent only suggests. The user decides about each change. The agent does nothing until the user asks.
- **Suggestions are safe.** They are stored in the note itself. They stay after a reload or a restart, and they can be read without the plugin. They go into version control with the note, like a Word file with its review state.
- **The agent learns from the user.** It sees each decision on the next request: accepted, changed before accept, or rejected with a reason. Over time it learns the user's style.
- **Fast feedback.** One click in Obsidian, or one prompt in the terminal, and the agent gets the decisions at once.
- **Low cost.** The agent gets short summaries, not full notes, and gets details only when it needs them. This keeps the token use, and so the cost, low.
- **Useful without an agent.** Track changes also works for the user's own edits, with no agent session.

## Principles

- **Every agent action is started by the user.** No automatic wake-up, no background sends.
- **Suggest only.** The agent never changes a note directly.
- **The note is the source of truth.** Everything the user must see is in the note, in an open text format.
- **Only on request.** The co-editor runs only in a session that the user starts for it. It never loads into other agent sessions.
- **Agent-neutral.** Claude Code is first. The design must allow other agents later.
- **Small steps.** Build the smallest loop that works from end to end first, then add to it.

## Not in scope

- An agent that edits on its own.
- Mobile devices. MD-Coeditor is for desktop only.
- Agents other than Claude Code, for now. Codex, Gemini and Pi can come later.
- Track changes in note properties (frontmatter), code and tables.

## Success

MD-Coeditor works when a user can do all of this in a normal writing session:

1. Select text, ask the agent, and see its suggestions inline in the note.
2. Accept, reject, edit before accept, or reject with a reason, and see that the agent uses these decisions in its next pass.
3. Type in the terminal only, and the agent still knows the latest decisions.
4. Edit the note in another tool, and see these edits as tracked changes.
5. Close Obsidian, get suggestions from the agent anyway, and see them when Obsidian opens again.
6. Track their own edits with no agent session.
7. Start a normal agent session that has no co-editor parts in it.
