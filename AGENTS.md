# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Build and test

- `npm test` runs everything. Unit and CLI tests need no OpenSCAD; `test/integration.test.js` skips
  itself with a clear message when the binary is absent. Verify both modes before shipping:
  `npm test` and `OPENSCAD_AXI_BIN=/nonexistent npm test`.
- `skill/SKILL.md` is generated. Never hand-edit it. Change `scripts/gen-skill.js` or the shared
  strings in `src/strings.js`, run `npm run gen-skill`, and commit the result;
  `npm run check-skill` fails CI on drift.

## Architecture

- Command handlers build payload objects and pass them to `src/lib/output.js`, the only module that
  writes stdout and the boundary where JSON is converted to TOON.
- Copy shared by the CLI help, home view, and generated skill lives in `src/strings.js`;
  command-specific help stays with each command. No em dash anywhere in user-facing text.
- Each command in `src/commands/` exports `spec` (its flag table), `help`, and `run`. The flag spec
  is what makes unknown-flag rejection exact, so add new flags there rather than reading argv.

## OpenSCAD behavior worth knowing

These were verified against 2026.06.12 and are easy to get wrong:

- Echo export (`--export-format=echo`) writes ERROR and WARNING lines into the `-o` file, not only
  stderr. `validate` reads both.
- `--summary` geometry only carries the `simple` manifold flag when the design does real boolean
  work. A single primitive yields PolySet stats with no `simple`, which is honestly `unknown`.
- When OpenSCAD hits non-manifold input it drops that geometry and the summary then describes only
  the remainder, so `simple: true` can coexist with a non-manifold model. `export` treats stderr
  evidence as authoritative over the summary for this reason.
- Native `--export-format=param` ignores trailing `// [20:200] Width in mm` comments and attributes
  a preceding comment to the first parameter. `params` merges it with the comment extractor.
- `--render` needs a separate empty argument (`'--render', ''`), not `--render=`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
