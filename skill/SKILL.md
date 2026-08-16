---
name: openscad-axi
description: >-
  Create, preview, validate, and export OpenSCAD 3D-printable models via
  npx -y openscad-axi. Use when designing .scad files, iterating on 3D prints,
  generating multi-angle previews, extracting Customizer parameters, or
  exporting STL for slicers or MakerWorld.
user-invocable: false
---

# openscad-axi

Agent-ergonomic wrapper around OpenSCAD for the write, preview, export loop.

You do not need openscad-axi installed globally - invoke it with `npx -y openscad-axi <command>`.
If openscad-axi output shows a follow-up command starting with `openscad-axi`, run it as
`npx -y openscad-axi ...` instead.

Requires OpenSCAD installed (`brew install --cask openscad@snapshot` preferred). If a command
reports the binary is missing, run `npx -y openscad-axi doctor` and relay its advice.

## Workflow

1. Run `npx -y openscad-axi` to see models in the current directory and their status.
2. Run `npx -y openscad-axi next <name>` to get the next versioned file path. Write the
   OpenSCAD source there yourself with the editor, the CLI never generates .scad code.
   Put Customizer comments on parameters: `width = 50; // [20:100] Width in mm`.
3. Run `npx -y openscad-axi validate <file>` after every edit (fast, catches syntax and warnings).
4. Run `npx -y openscad-axi preview <file>` for six PNGs (iso/front/back/left/right/top).
   **Read every PNG path in the output before changing the model.** Use `--compare` from
   version 002 on, and Read the previous version's PNGs too.
5. Iterate steps 2-4 until all views look correct.
6. Run `npx -y openscad-axi export <file>`. Only `status: ok` with `manifold: true` is
   print-ready; `warning` means fix geometry and re-export. Check `size_mm` matches the
   intended real-world dimensions.

## Commands

```
commands[8]:
  (none)=models dashboard, next, validate, preview, params, export, doctor, setup
```

Run `npx -y openscad-axi <command> --help` for per-command flags.

## Printability (design-time rules)

- Min wall 0.4mm; overhangs under 45 degrees or chamfer/support; bridges under 10mm
- All geometry connected and on the bed; fit clearance 0.2-0.5mm between mating parts
- Closed solids only; union() overlapping shapes; $fn for curves (minkowski is slow)

## Tips

- Output is TOON-encoded; `--json` gives a JSON envelope where needed.
- Exit codes: 0 success or idempotent no-op, 1 runtime failure, 2 usage error.
- Override parameters without editing: `-D width=80` on preview and export.
- `--angle iso` renders one view when iterating quickly; do a full six-angle pass before export.
