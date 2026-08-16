import { statSync } from 'node:fs';
import path from 'node:path';
import { probe } from '../openscad.js';
import { binPath, collapseHome, emit, EXIT_OK } from '../lib/output.js';
import { groupModels } from '../lib/versions.js';
import { ANGLE_NAMES } from '../lib/cameras.js';
import { DESCRIPTION, DOCTOR_HINT, EMPTY_HOME_HELP, HOME_HELP, NPX } from '../strings.js';

export const spec = {};

export const help = {
  usage: `${NPX}`,
  summary: 'Dashboard of versioned OpenSCAD models in the current directory',
  flags: [],
  examples: [NPX],
};

function mtimeOf(target) {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

function previewState(cwd, stem) {
  const dir = path.join(cwd, 'previews', stem);
  let present = 0;
  let newest = null;
  for (const angle of ANGLE_NAMES) {
    const mtime = mtimeOf(path.join(dir, `${stem}_${angle}.png`));
    if (mtime === null) continue;
    present += 1;
    if (newest === null || mtime > newest) newest = mtime;
  }
  return { present, total: ANGLE_NAMES.length, newest };
}

// Staleness is pure mtime comparison: .scad newer than an artifact means that
// artifact no longer describes the model.
function deriveStatus(scadMtime, previews, stlMtime) {
  const previewsFresh =
    previews.present === previews.total && previews.newest !== null && previews.newest >= scadMtime;
  if (!previewsFresh) return 'needs_preview';
  if (stlMtime === null || stlMtime < scadMtime) return 'needs_export';
  return 'ok';
}

export function run({ json, cwd = process.cwd() }) {
  const { models, loose } = groupModels(cwd);
  const payload = {
    bin: binPath(),
    description: DESCRIPTION,
  };

  // Orientation must work without OpenSCAD installed, so the probe failure is
  // reported inline rather than aborting the dashboard.
  const info = probe();
  if (info.bin) {
    const details = [info.version || 'unknown version', `backend: ${info.backend}`].join(', ');
    payload.openscad = `${collapseHome(info.bin)} (${details})`;
  } else {
    payload.openscad = 'not found';
  }

  if (models.length === 0 && loose.length === 0) {
    payload.models = '0 .scad files found in this directory';
    payload.help = info.bin ? EMPTY_HOME_HELP : [...EMPTY_HOME_HELP, DOCTOR_HINT];
    emit(payload, { json });
    return EXIT_OK;
  }

  if (models.length > 0) {
    payload.models = models.map((model) => {
      const stem = path.basename(model.latest.file, '.scad');
      const scadMtime = mtimeOf(path.join(cwd, model.latest.file)) ?? 0;
      const previews = previewState(cwd, stem);
      const stlName = `${stem}.stl`;
      const stlMtime = mtimeOf(path.join(cwd, stlName));
      return {
        name: model.name,
        latest: String(model.latest.file.match(/_(\d{3})\.scad$/)[1]),
        previews: `${previews.present}/${previews.total}`,
        stl: stlMtime === null ? 'missing' : stlName,
        status: deriveStatus(scadMtime, previews, stlMtime),
      };
    });
  } else {
    payload.models = '0 versioned .scad files found in this directory';
  }

  if (loose.length > 0) {
    payload.loose = loose.length;
  }

  payload.help = info.bin ? HOME_HELP : [...HOME_HELP, DOCTOR_HINT];
  emit(payload, { json });
  return EXIT_OK;
}
