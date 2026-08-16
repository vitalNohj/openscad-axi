import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseDefines, UsageError } from '../lib/args.js';
import { emit, EXIT_ERROR, EXIT_OK } from '../lib/output.js';
import { backendArgs, requireOpenscad, run as spawnOpenscad } from '../openscad.js';
import { ANGLE_NAMES, CAMERAS, COLORSCHEMES, DEFAULT_COLORSCHEME, DEFAULT_SIZE, parseSize } from '../lib/cameras.js';
import { firstErrorLine, hasEmptyGeometry, parseIssues } from '../lib/warnings.js';
import { previousVersionFile, stemOf } from '../lib/versions.js';
import { NPX, previewCompareMissingDetail, previewCompareMissingHelp } from '../strings.js';

export const spec = {
  '--angle': { type: 'value' },
  '--size': { type: 'value' },
  '--compare': { type: 'boolean' },
  '--colorscheme': { type: 'value' },
  '--full-render': { type: 'boolean' },
  '--out': { type: 'value' },
  '-D': { type: 'repeat' },
};

export const help = {
  usage: `${NPX} preview <file.scad> [--angle <name>] [--size WxH] [--compare] [--colorscheme <name>] [--full-render] [--out <dir>] [-D var=value]`,
  summary: 'Render named-camera PNGs for visual verification, then Read every PNG path',
  flags: [
    `--angle        one of ${ANGLE_NAMES.join('|')}|all (default all)`,
    `--size         WxH pixels (default ${DEFAULT_SIZE})`,
    '--compare      also list the previous version PNG paths',
    `--colorscheme  OpenSCAD color scheme (default ${DEFAULT_COLORSCHEME})`,
    '--full-render  full geometry evaluation, slower and more accurate',
    '--out          output directory (default previews/<stem>/)',
    '-D             override a parameter, repeatable (-D width=80)',
  ],
  examples: [
    `${NPX} preview phone_stand_003.scad`,
    `${NPX} preview phone_stand_003.scad --angle iso`,
    `${NPX} preview phone_stand_003.scad --compare -D width=80`,
  ],
  notes: ['Read every PNG path in the output before changing the model.'],
};

function previewPaths(dir, stem, angles) {
  return angles.map((angle) => ({ angle, path: path.join(dir, `${stem}_${angle}.png`) }));
}

export function run({ positional, flags, json, cwd = process.cwd() }) {
  const file = positional[0];
  if (!file) {
    throw new UsageError('preview requires a .scad file', [`Run \`${NPX} preview <file.scad>\``]);
  }
  if (positional.length > 1) {
    throw new UsageError(`preview takes one file, got ${positional.length}`, [
      `Run \`${NPX} preview <file.scad>\``,
    ]);
  }

  const angleFlag = flags['--angle'] || 'all';
  if (angleFlag !== 'all' && !ANGLE_NAMES.includes(angleFlag)) {
    throw new UsageError(`unknown angle \`${angleFlag}\``, [
      `valid angles: ${ANGLE_NAMES.join(', ')}, all`,
    ]);
  }
  const angles = angleFlag === 'all' ? ANGLE_NAMES : [angleFlag];

  const size = parseSize(flags['--size'] || DEFAULT_SIZE);
  if (!size) {
    throw new UsageError(`invalid --size \`${flags['--size']}\``, [
      `Use WxH in pixels, for example --size ${DEFAULT_SIZE}`,
    ]);
  }

  const colorscheme = flags['--colorscheme'] || DEFAULT_COLORSCHEME;
  if (!COLORSCHEMES.includes(colorscheme)) {
    throw new UsageError(`unknown colorscheme \`${colorscheme}\``, [
      `valid color schemes: ${COLORSCHEMES.join(', ')}`,
    ]);
  }

  const defines = parseDefines(flags['-D'], 'preview');
  const absolute = path.resolve(cwd, file);
  if (!existsSync(absolute)) {
    emit(
      { error: `file not found: ${file}`, help: [`Run \`${NPX}\` to list models in this directory`] },
      { json }
    );
    return EXIT_ERROR;
  }

  const stem = stemOf(file);
  const outDir = flags['--out'] || path.join('previews', stem);
  mkdirSync(path.resolve(cwd, outDir), { recursive: true });

  const info = requireOpenscad();
  const targets = previewPaths(outDir, stem, angles);
  const issues = [];
  let emptyGeometry = false;

  for (const target of targets) {
    const args = [
      ...backendArgs(info),
      `--camera=${CAMERAS[target.angle]}`,
      `--imgsize=${size.width},${size.height}`,
      `--colorscheme=${colorscheme}`,
      '--autocenter',
      '--viewall',
    ];
    if (flags['--full-render']) args.push('--render', '');
    for (const define of defines) args.push('-D', define);
    args.push('-o', path.resolve(cwd, target.path), absolute);

    const result = spawnOpenscad(info.bin, args, { cwd });
    if (result.status !== 0) {
      emit(
        {
          error: `preview failed for angle ${target.angle}`,
          detail: firstErrorLine(result.stderr) || 'OpenSCAD exited nonzero',
          help: [`Run \`${NPX} validate ${file}\` to locate the problem`],
        },
        { json }
      );
      return EXIT_ERROR;
    }
    if (hasEmptyGeometry(result.stderr)) emptyGeometry = true;
    for (const issue of parseIssues(result.stderr)) {
      if (!issues.some((existing) => existing.code === issue.code && existing.detail === issue.detail)) {
        issues.push(issue);
      }
    }
  }

  const payload = {
    preview: {
      input: file,
      dir: outDir,
      size: size.text,
    },
  };

  let comparedTo = null;
  let comparisonFile = null;
  if (flags['--compare']) {
    const previous = previousVersionFile(cwd, file);
    if (previous) {
      comparisonFile = previous;
      comparedTo = path.join('previews', stemOf(previous));
      payload.preview.compared_to = comparedTo;
    } else {
      payload.preview.compared_to = 'none (this is the first version)';
    }
  }

  if (emptyGeometry) {
    payload.preview.status = 'warning';
    issues.unshift({ code: 'warning', detail: 'Top level object is empty; the PNGs will be blank' });
  }

  payload.pngs = targets;

  let comparisonHelp = null;
  if (comparedTo) {
    const previousStem = path.basename(comparedTo);
    payload.compare_pngs = previewPaths(comparedTo, previousStem, ANGLE_NAMES).map((entry) => ({
      ...entry,
      state: existsSync(path.resolve(cwd, entry.path)) ? 'ready' : 'missing',
    }));
    const missingCount = payload.compare_pngs.filter((entry) => entry.state === 'missing').length;
    if (missingCount) {
      payload.preview.status = 'warning';
      issues.push({ code: 'warning', detail: previewCompareMissingDetail(missingCount) });
      comparisonHelp = previewCompareMissingHelp(comparisonFile);
    }
  }

  if (issues.length) payload.issues = issues;

  payload.help = [
    'Read every PNG path above before changing the model',
    ...(comparisonHelp ? [comparisonHelp] : []),
    emptyGeometry
      ? `Fix the empty geometry then run \`${NPX} preview ${file}\``
      : `Run \`${NPX} export ${file}\` if all views look correct`,
  ];

  emit(payload, { json });
  return EXIT_OK;
}
