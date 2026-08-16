import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageError } from '../lib/args.js';
import { emit, EXIT_ERROR, EXIT_OK, truncate } from '../lib/output.js';
import { probe, run as spawnOpenscad } from '../openscad.js';
import { extractParams, translateNativeParams } from '../lib/customizer.js';
import { NPX } from '../strings.js';

export const spec = {
  '--full': { type: 'boolean' },
};

export const help = {
  usage: `${NPX} params <file.scad> [--full]`,
  summary: 'List the Customizer parameters a model exposes',
  flags: ['--full  include untruncated descriptions'],
  examples: [`${NPX} params parametric_box.scad`, `${NPX} params phone_stand.scad --full`],
};

const DESCRIPTION_LIMIT = 60;

function nativeParams(info, absolute, cwd) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-'));
  const target = path.join(tmpDir, 'params.json');
  try {
    const result = spawnOpenscad(info.bin, ['-o', target, '--export-format=param', absolute], { cwd });
    if (result.status !== 0 || !existsSync(target)) return null;
    return translateNativeParams(JSON.parse(readFileSync(target, 'utf8')));
  } catch {
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function run({ positional, flags, json, cwd = process.cwd() }) {
  const file = positional[0];
  if (!file) {
    throw new UsageError('params requires a .scad file', [`Run \`${NPX} params <file.scad>\``]);
  }
  if (positional.length > 1) {
    throw new UsageError(`params takes one file, got ${positional.length}`, [
      `Run \`${NPX} params <file.scad>\``,
    ]);
  }
  const absolute = path.resolve(cwd, file);
  if (!existsSync(absolute)) {
    emit(
      { error: `file not found: ${file}`, help: [`Run \`${NPX}\` to list models in this directory`] },
      { json }
    );
    return EXIT_ERROR;
  }

  // OpenSCAD's own param export is authoritative for names, values, and types.
  // It does not read trailing `// [20:200] Width in mm` comments though, so the
  // comment parser backfills constraint and description where native is blank.
  const info = probe();
  const fromComments = extractParams(readFileSync(absolute, 'utf8'));
  let params = null;
  let source = 'customizer_comments';
  if (info.bin && info.param_export) {
    const native = nativeParams(info, absolute, cwd);
    if (native) {
      const byName = new Map(fromComments.map((param) => [param.name, param]));
      let backfilled = false;
      params = native.map((param) => {
        const fallback = byName.get(param.name);
        if (!fallback) return param;
        const constraint = param.constraint || fallback.constraint;
        // A trailing `// ... Width in mm` comment describes the parameter it
        // sits on; the native caption comes from the preceding line and can
        // belong to the file header instead, so the trailing comment wins.
        const description = fallback.description || param.description;
        if (constraint !== param.constraint || description !== param.description) backfilled = true;
        return { ...param, constraint, description };
      });
      source = backfilled ? 'openscad_param_export+customizer_comments' : 'openscad_param_export';
    }
  }
  if (!params) {
    params = fromComments;
  }

  if (params.length === 0) {
    emit(
      {
        params: `0 customizer parameters found in ${file}`,
        help: [
          'Add Customizer comments to expose parameters, for example `width = 50; // [20:100] Width in mm`',
        ],
      },
      { json }
    );
    return EXIT_OK;
  }

  const full = Boolean(flags['--full']);
  let anyTruncated = false;
  const rows = params.map((param) => {
    let description = param.description || '';
    if (!full && description.length > DESCRIPTION_LIMIT) {
      const shown = truncate(description, DESCRIPTION_LIMIT);
      description = `${shown.text}...`;
      anyTruncated = true;
    }
    return {
      name: param.name,
      value: param.value,
      type: param.type,
      constraint: param.constraint || '',
      description,
    };
  });

  const payload = { params: rows, source };
  payload.help = [
    `Override with \`${NPX} preview ${file} -D <name>=<value>\` or the same flag on export`,
  ];
  if (anyTruncated) {
    payload.help.push(`Run \`${NPX} params ${file} --full\` for complete descriptions`);
  }
  emit(payload, { json });
  return EXIT_OK;
}
