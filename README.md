# openscad-axi

An agent-facing CLI that wraps a local OpenSCAD install so coding agents can design, verify, and
export 3D-printable models without guessing. It is built to AXI conventions:
[TOON](https://toonformat.dev/)-encoded stdout,
structured errors, contextual next-step hints, and exit codes an agent can branch on. The CLI never
generates `.scad` source; the agent writes the model with its editor and openscad-axi handles
versioning, validation, multi-angle rendering, parameter extraction, and honest export reporting.

```
next  ->  write .scad  ->  validate  ->  preview  ->  Read the PNGs  ->  export
            ^                                              |
            |______________________________________________|
                        iterate until every view is correct
```

## Install

Nothing to install for the CLI itself:

```sh
npx -y openscad-axi
```

OpenSCAD is a prerequisite. The snapshot build is strongly preferred, because the stable 2021.01
release predates the flags this CLI relies on for real validation:

```sh
brew install --cask openscad@snapshot
```

| Capability                              | 2021.01 stable | Snapshot |
| --------------------------------------- | -------------- | -------- |
| Preview PNGs, echo validation           | yes            | yes      |
| `--backend=manifold` (10-30x faster)    | no             | yes      |
| `--summary` manifold + bounding box     | no             | yes      |
| Native Customizer parameter export      | no             | yes      |

Run `npx -y openscad-axi doctor` to see exactly what your install supports. Without `--summary`,
export honestly reports `manifold: unknown` instead of guessing.

Set `OPENSCAD_AXI_BIN` to point at a specific OpenSCAD executable. If it is set but not executable,
commands fail loudly rather than silently falling back to a different install.

## Agent integration

Two ways to make an agent aware of this tool. You only need one.

**Session integration (primary).** Installs startup integration so every session opens with the
current directory's model dashboard already in context:

```sh
npx -y openscad-axi setup hooks
```

This installs SessionStart hooks for Claude Code and Codex, and a managed plugin for OpenCode. It is
idempotent, repairs a stale path after a reinstall, and reports `installed`, `repaired`, or
`unchanged` per app. Use `--app` to target one.

**Installable skill (secondary).** Loads on demand when the agent recognizes a matching task, with
no per-session token cost:

```sh
npx skills add vitalNohj/openscad-axi --skill openscad-axi
```

`skill/SKILL.md` is generated from shared CLI strings. CI runs `npm run check-skill` to ensure the
committed skill matches its generator.

## Commands

| Command            | What it does                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| `(none)`           | Dashboard of versioned models in the current directory with a derived status   |
| `next <name>`      | The next `name_NNN.scad` path to write                                        |
| `validate <file>`  | Parse and evaluate without rendering; warnings as structured issues            |
| `preview <file>`   | Six named-camera PNGs under `previews/<stem>/` for visual verification         |
| `params <file>`    | Customizer parameters with types and constraints                              |
| `export <file>`    | Printable mesh with available manifold, triangle, and real-world size facts    |
| `doctor`           | Binary path, version, and which capabilities are available                     |
| `setup hooks`      | Install startup dashboard integration for supported agents                     |

Global flags work on every command: `--json` for a JSON envelope instead of TOON, `--help`, and
`-v`/`--version`. Run `npx -y openscad-axi <command> --help` for per-command flags.

### Preview angles

`preview` renders six cameras by default, which is what catches inverted normals, boolean mistakes,
and floating geometry that a syntax check cannot: `iso`, `front`, `back`, `left`, `right`, `top`.
Use `--angle iso` for a single cheap view while iterating, and do a full six-angle pass before
export. The agent must Read every PNG; the CLI reports paths, not pixels.

### Honest export

`export` runs one OpenSCAD invocation. It requests `--export-format binstl` by default and adds
`--summary all --summary-file` and `--backend=manifold` when the installed build supports them. It
reports `manifold: true` only when OpenSCAD's own `simple` flag says so, and it caps at `unknown`
when the build cannot answer. Quiet stderr is never treated as a pass. When OpenSCAD drops
non-manifold geometry and reports the surviving remainder as simple, that is flagged rather than
reported as success.

## Development

```sh
npm test              # unit + CLI tests run with no OpenSCAD; integration tests skip cleanly
npm run gen-skill     # regenerate skill/SKILL.md
npm run check-skill   # fail if the committed skill has drifted
```

## Credits

MIT licensed. This tool combines and corrects ideas from two prior OpenSCAD agent toolkits:

- [iancanderson/openscad-agent](https://github.com/iancanderson/openscad-agent) - the
  `name_NNN.scad` versioning scheme, the printability rules, and stderr-based issue detection.
- [mitsuhiko/agent-stuff `skills/openscad`](https://github.com/mitsuhiko/agent-stuff/tree/main/skills/openscad) -
  the six named preview cameras, echo-export validation, the Customizer extractor, and the example
  models used as test fixtures.

Both are MIT licensed; see `LICENSE` for their attribution.
