import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError } from '../lib/args.js';
import { emit, EXIT_ERROR, EXIT_OK, truncate } from '../lib/output.js';
import { requireOpenscad, run as spawnOpenscad } from '../openscad.js';
import { echoLines, firstErrorLine, parseErrorLocation, parseIssues } from '../lib/warnings.js';
import { NPX } from '../strings.js';

export const spec = {
  '--full': { type: 'boolean' },
};

export const help = {
  usage: `${NPX} validate <file.scad> [--full]`,
  summary: 'Parse and evaluate a model without rendering geometry',
  flags: ['--full  print untruncated echo output and every warning'],
  examples: [`${NPX} validate piano_003.scad`, `${NPX} validate piano_003.scad --full`],
};

const ECHO_LIMIT = 500;

// Single pass without --hardwarnings: we parse stderr into issues ourselves, so
// conflating warnings into the exit code would lose information.
export function run({ positional, flags, json, cwd = process.cwd() }) {
  const file = positional[0];
  if (!file) {
    throw new UsageError('validate requires a .scad file', [
      `Run \`${NPX} validate <file.scad>\``,
    ]);
  }
  if (positional.length > 1) {
    throw new UsageError(`validate takes one file, got ${positional.length}`, [
      `Run \`${NPX} validate <file.scad>\``,
    ]);
  }
  const absolute = path.resolve(cwd, file);
  if (!existsSync(absolute)) {
    emit(
      {
        error: `file not found: ${file}`,
        help: [`Run \`${NPX}\` to list models in this directory`],
      },
      { json }
    );
    return EXIT_ERROR;
  }

  const info = requireOpenscad();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-'));
  const tmpOut = path.join(tmpDir, 'validate.echo');
  let result;
  let echoFile = '';
  try {
    result = spawnOpenscad(info.bin, ['-o', tmpOut, '--export-format=echo', absolute], { cwd });
    // Echo export routes ECHO, WARNING, and ERROR lines into the output file
    // rather than stderr, so diagnostics live in both places.
    if (existsSync(tmpOut)) echoFile = readFileSync(tmpOut, 'utf8');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const diagnostics = `${echoFile}\n${result.stderr}`;
  const full = Boolean(flags['--full']);
  const issues = parseIssues(diagnostics);

  if (result.status !== 0) {
    const location = parseErrorLocation(diagnostics);
    const payload = {
      validate: {
        input: file,
        status: 'error',
        detail: firstErrorLine(diagnostics) || 'OpenSCAD could not parse the file',
      },
    };
    if (location) payload.validate.line = location.line;
    payload.help = [`Fix the reported line in ${file} then run \`${NPX} validate ${file}\``];
    emit(payload, { json });
    return EXIT_ERROR;
  }

  const echo = echoLines(diagnostics)
    .map((line) => line.replace(/^ECHO:\s*/, ''))
    .join('\n');
  let status = 'ok';
  if (issues.some((issue) => issue.code === 'syntax_error')) status = 'error';
  else if (issues.length) status = 'warning';
  const payload = { validate: { input: file, status } };
  if (issues.length) payload.issues = issues;

  if (echo) {
    const shown = full ? { text: echo, truncated: false, total: echo.length } : truncate(echo, ECHO_LIMIT);
    payload.echo = shown.truncated ? `${shown.text}... (truncated, ${shown.total} chars total)` : shown.text;
    if (shown.truncated) {
      payload.help = [`Run \`${NPX} validate ${file} --full\` for complete output`];
    }
  }

  if (!payload.help) {
    payload.help =
      status === 'ok'
        ? [`Run \`${NPX} preview ${file}\` then Read each PNG`]
        : [`Fix the warnings above, then run \`${NPX} validate ${file}\``];
  }

  emit(payload, { json });
  return EXIT_OK;
}
