// Single source of truth for user-facing copy. The CLI help, the home view, and
// the generated skill all read from here, so scripts/gen-skill.js cannot drift
// from what the CLI actually prints.

export const NPX = 'npx -y openscad-axi';

export const DESCRIPTION =
  'Create, preview, validate, and export OpenSCAD models in this directory';

export const SKILL_DESCRIPTION = [
  'Create, preview, validate, and export OpenSCAD 3D-printable models via',
  'npx -y openscad-axi. Use when designing .scad files, iterating on 3D prints,',
  'generating multi-angle previews, extracting Customizer parameters, or',
  'exporting STL for slicers or MakerWorld.',
];

export const COMMAND_SUMMARY = [
  '(none)=models dashboard',
  'next',
  'validate',
  'preview',
  'params',
  'export',
  'doctor',
  'setup',
];

export const INSTALL_COMMAND = 'brew install --cask openscad@snapshot';

export const INSTALL_HINT = `Install with \`${INSTALL_COMMAND}\` (snapshot has manifold + summary support)`;

export const DOCTOR_HINT = `Run \`${NPX} doctor\` for diagnosis`;

export const HOME_HELP = [
  `Run \`${NPX} next <name>\` for the next version path`,
  `Run \`${NPX} preview <file.scad>\` then Read each PNG`,
  `Run \`${NPX} export <file.scad>\` when previews look correct`,
];

export const EMPTY_HOME_HELP = [
  `Run \`${NPX} next <name>\` to get a path for your first model`,
];

// Each entry is one numbered step of the agent loop, rendered verbatim into the
// skill and summarized by `--help`.
export const WORKFLOW = [
  `Run \`${NPX}\` to see models in the current directory and their status.`,
  `Run \`${NPX} next <name>\` to get the next versioned file path. Write the
   OpenSCAD source there yourself with the editor, the CLI never generates .scad code.
   Put Customizer comments on parameters: \`width = 50; // [20:100] Width in mm\`.`,
  `Run \`${NPX} validate <file>\` after every edit (fast, catches syntax and warnings).`,
  `Run \`${NPX} preview <file>\` for six PNGs (iso/front/back/left/right/top).
   **Read every PNG path in the output before changing the model.** Use \`--compare\` from
   version 002 on, and Read the previous version's PNGs too.`,
  'Iterate steps 2-4 until all views look correct.',
  `Run \`${NPX} export <file>\`. Only \`status: ok\` with \`manifold: true\` is
   print-ready; \`warning\` means fix geometry and re-export. Check \`size_mm\` matches the
   intended real-world dimensions.`,
];

export const PRINTABILITY = [
  'Min wall 0.4mm; overhangs under 45 degrees or chamfer/support; bridges under 10mm',
  'All geometry connected and on the bed; fit clearance 0.2-0.5mm between mating parts',
  'Closed solids only; union() overlapping shapes; $fn for curves (minkowski is slow)',
];

export const TIPS = [
  'Output is TOON-encoded; `--json` gives a JSON envelope where needed.',
  'Exit codes: 0 success or idempotent no-op, 1 runtime failure, 2 usage error.',
  'Override parameters without editing: `-D width=80` on preview and export.',
  '`--angle iso` renders one view when iterating quickly; do a full six-angle pass before export.',
];

// Fix hints keyed by issue code, used by export and validate.
export const ISSUE_HINTS = {
  non_manifold: 'Ensure all shapes are closed solids and union() overlapping shapes',
  self_intersect: 'Use union() to combine overlapping shapes',
  degenerate: 'Check for zero-thickness features',
};
