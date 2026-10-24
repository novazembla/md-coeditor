# Spikes

A spike is a small, throwaway experiment. It answers one question, for example "does this API work as we think?".

Rules:

- Spikes are not product code. Do not import spike code from `packages/*` or `adapters/*`.
- A spike may import from `packages/*`.
- Each spike is in its own folder: `spikes/<name>/`. It can have its own `package.json`.
- Spikes stay outside OpenSpec. They need no change, spec or tasks.
- Write down the result (for example in the OpenSpec change that needed it), then delete the spike.

Planned spikes:

- S1 live tracking: record edits as CriticMarkup while the user types in Obsidian.
- S2 channels: send events from the hub into a running Claude Code session.
