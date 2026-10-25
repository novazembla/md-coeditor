# Welcome

This vault is for manual tests of the MD-Coeditor plugin. Do not keep real notes here.

## Link the plugin

1. In the repository root, run `pnpm build`.
2. In this folder, run `coedit init --dev`. This links `.obsidian/plugins/md-coeditor` to `packages/obsidian/dist`.
3. Open this folder as a vault in Obsidian.
4. Go to Settings → Community plugins. Turn off restricted mode, then turn on MD-Coeditor.

After you change the plugin code, run `pnpm build` again (or `pnpm dev` for watch mode) and reload the plugin.
