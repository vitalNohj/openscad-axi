import { probe, SEARCHED_DESCRIPTION } from '../openscad.js';
import { binPath, collapseHome, emit, EXIT_OK } from '../lib/output.js';
import { INSTALL_HINT, NPX } from '../strings.js';

export const spec = {};

export const help = {
  usage: `${NPX} doctor`,
  summary: 'Report the OpenSCAD binary, version, and available capabilities',
  flags: [],
  examples: [`${NPX} doctor`],
};

// Diagnosis, never a verdict: doctor exits 0 even when nothing is installed,
// because "not found" is the information the agent asked for.
export function run({ json }) {
  const info = probe({ force: true });
  const payload = {
    doctor: {
      bin: binPath(),
    },
  };

  if (!info.bin) {
    payload.doctor.openscad = 'not found';
    payload.doctor.searched = info.reason || SEARCHED_DESCRIPTION;
    payload.help = [INSTALL_HINT, 'Or set OPENSCAD_AXI_BIN to an OpenSCAD executable'];
    emit(payload, { json });
    return EXIT_OK;
  }

  payload.doctor.openscad = collapseHome(info.bin);
  payload.doctor.version = info.version || 'unknown';
  payload.doctor.backend = info.backend_flag
    ? 'manifold'
    : 'cgal-default (slow; install openscad@snapshot for manifold)';
  payload.doctor.summary_support = info.summary_support
    ? 'true'
    : 'false (validation falls back to stderr parsing, manifold status will be unknown)';
  payload.doctor.param_export = info.param_export
    ? 'true'
    : 'false (Customizer parameters come from comment parsing instead)';

  const degraded = !info.backend_flag || !info.summary_support || !info.param_export;
  payload.help = degraded ? [INSTALL_HINT] : ['All capabilities available'];
  emit(payload, { json });
  return EXIT_OK;
}
