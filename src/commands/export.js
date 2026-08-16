import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDefines, UsageError } from '../lib/args.js';
import { emit, EXIT_ERROR, EXIT_OK, humanSize } from '../lib/output.js';
import { backendArgs, requireOpenscad, run as spawnOpenscad } from '../openscad.js';
import { firstErrorLine, parseIssues } from '../lib/warnings.js';
import { geometryFacts, readSummary, trianglesFromBinaryStl } from '../lib/summary.js';
import { stemOf } from '../lib/versions.js';
import { ISSUE_HINTS, NPX } from '../strings.js';

const FORMATS = ['binstl', 'asciistl', '3mf'];

export const spec = {
  '--output': { type: 'value' },
  '--format': { type: 'value' },
  '--force': { type: 'boolean' },
  '-D': { type: 'repeat' },
};

export const help = {
  usage: `${NPX} export <file.scad> [--output <path>] [--format <binstl|asciistl|3mf>] [--force] [-D var=value]`,
  summary: 'Render a printable mesh and report manifold status honestly',
  flags: [
    '--output  output path (default <stem>.stl)',
    `--format  ${FORMATS.join('|')} (default binstl)`,
    '--force   re-export even when the existing output is newer than the model',
    '-D        override a parameter, repeatable (-D width=80)',
  ],
  examples: [
    `${NPX} export phone_stand_003.scad`,
    `${NPX} export phone_stand_003.scad --output build/stand.stl`,
    `${NPX} export phone_stand_003.scad -D device_width=90 --force`,
  ],
};

function mtimeOf(target) {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

function extensionFor(format) {
  return format === '3mf' ? '.3mf' : '.stl';
}

export function run({ positional, flags, json, cwd = process.cwd() }) {
  const file = positional[0];
  if (!file) {
    throw new UsageError('export requires a .scad file', [`Run \`${NPX} export <file.scad>\``]);
  }
  if (positional.length > 1) {
    throw new UsageError(`export takes one file, got ${positional.length}`, [
      `Run \`${NPX} export <file.scad>\``,
    ]);
  }

  const format = flags['--format'] || 'binstl';
  if (!FORMATS.includes(format)) {
    throw new UsageError(`unknown format \`${format}\``, [`valid formats: ${FORMATS.join(', ')}`]);
  }
  const defines = parseDefines(flags['-D'], 'export');

  const absolute = path.resolve(cwd, file);
  if (!existsSync(absolute)) {
    emit(
      { error: `file not found: ${file}`, help: [`Run \`${NPX}\` to list models in this directory`] },
      { json }
    );
    return EXIT_ERROR;
  }

  const output = flags['--output'] || `${stemOf(file)}${extensionFor(format)}`;
  const outputAbsolute = path.resolve(cwd, output);

  // Idempotent no-op: a fresh output for an unchanged model with no overrides
  // is already the requested state.
  const outputMtime = mtimeOf(outputAbsolute);
  const inputMtime = mtimeOf(absolute) ?? 0;
  if (!flags['--force'] && outputMtime !== null && outputMtime > inputMtime && defines.length === 0) {
    emit(
      {
        export: `${output} already up to date (no-op)`,
        help: [`Run \`${NPX} export ${file} --force\` to re-export anyway`],
      },
      { json }
    );
    return EXIT_OK;
  }

  const info = requireOpenscad();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-'));
  const summaryFile = path.join(tmpDir, 'summary.json');
  const args = [...backendArgs(info), '--export-format', format];
  if (info.summary_support) args.push('--summary', 'all', '--summary-file', summaryFile);
  for (const define of defines) args.push('-D', define);
  args.push('-o', outputAbsolute, absolute);

  let result;
  let summary = null;
  try {
    result = spawnOpenscad(info.bin, args, { cwd });
    if (info.summary_support && existsSync(summaryFile)) {
      summary = readSummary(readFileSync(summaryFile, 'utf8'));
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const issues = parseIssues(result.stderr);
  const fileExists = existsSync(outputAbsolute);

  // Both the exit code and the file are checked: a nonzero exit with a stale
  // file on disk is still a failure.
  if (result.status !== 0 || !fileExists) {
    emit(
      {
        export: { input: file, output, status: 'error' },
        detail: firstErrorLine(result.stderr) || 'OpenSCAD did not produce the output file',
        help: [`Run \`${NPX} validate ${file}\` to locate the problem`],
      },
      { json }
    );
    return EXIT_ERROR;
  }

  const bytes = statSync(outputAbsolute).size;
  const payload = {
    export: {
      input: file,
      output,
      format,
      file_size: humanSize(bytes),
    },
  };

  let manifold;
  let validation;
  if (summary) {
    const facts = geometryFacts(summary);
    manifold = facts.manifold;
    validation = 'geometry_summary';
    payload.export.triangles = facts.triangles ?? 'unknown';
    if (facts.vertices !== null) payload.export.vertices = facts.vertices;
    if (facts.size_mm) payload.export.size_mm = facts.size_mm;
  } else {
    // Legacy path: no summary JSON, so manifold is genuinely unknown and the
    // triangle count comes from the binary STL header.
    manifold = 'unknown';
    validation = 'openscad_stderr';
    if (format === 'binstl') {
      const triangles = trianglesFromBinaryStl(readFileSync(outputAbsolute));
      payload.export.triangles = triangles ?? 'unknown';
    } else {
      payload.export.triangles = 'unknown';
    }
  }

  // When OpenSCAD reports a non-manifold input it drops the offending geometry
  // and the summary then describes only what survived, so `simple: true` there
  // does not describe the model the agent wrote. Direct stderr evidence wins.
  const stderrNonManifold = issues.some((issue) => issue.code === 'non_manifold');
  if (stderrNonManifold && manifold === true) {
    manifold = false;
    payload.export.geometry_dropped = true;
  }

  payload.export.manifold = manifold;
  payload.export.backend = info.backend;
  payload.export.validation = validation;

  // Never claim ok without a positive manifold answer; a stderr-only run caps
  // at unknown.
  let status;
  if (manifold === false) {
    status = 'warning';
    if (!issues.some((issue) => issue.code === 'non_manifold')) {
      issues.push({
        code: 'non_manifold',
        detail: 'Geometry summary reports the mesh is not a simple manifold',
      });
    }
  } else if (issues.length) {
    status = 'warning';
  } else if (manifold === true) {
    status = 'ok';
  } else {
    status = 'unknown';
  }
  payload.export.status = status;

  if (issues.length) payload.issues = issues;

  const help = [];
  const seenCodes = new Set();
  for (const issue of issues) {
    if (seenCodes.has(issue.code)) continue;
    seenCodes.add(issue.code);
    if (ISSUE_HINTS[issue.code]) help.push(ISSUE_HINTS[issue.code]);
  }
  if (status === 'warning') {
    help.push(`Fix the geometry, then run \`${NPX} export ${file} --force\``);
  } else if (status === 'unknown') {
    help.push(
      validation === 'geometry_summary'
        ? 'OpenSCAD reported no manifold check for this model, which happens when the design is a single primitive with no boolean operations'
        : 'This OpenSCAD build cannot report manifold status; install openscad@snapshot for real validation'
    );
  }
  if (help.length) payload.help = help;

  emit(payload, { json });
  return EXIT_OK;
}
