// OpenSCAD binary discovery, capability probe, and spawn wrapper.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export const SEARCH_PATHS = [
  '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
  '/opt/homebrew/bin/openscad',
  '/usr/local/bin/openscad',
];

export const SEARCHED_DESCRIPTION =
  'searched OPENSCAD_AXI_BIN, PATH, /Applications/OpenSCAD.app, /opt/homebrew/bin, /usr/local/bin';

export class OpenscadMissingError extends Error {
  constructor(detail) {
    super('OpenSCAD binary not found');
    this.name = 'OpenscadMissingError';
    this.detail = detail || SEARCHED_DESCRIPTION;
  }
}

function isExecutable(target) {
  try {
    accessSync(target, constants.X_OK);
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

// Manual PATH scan rather than `command -v` in a shell: no shell means no
// quoting hazards and no deprecation warning on stderr.
export function onPath(name, env = process.env) {
  const entries = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

// First match wins. An OPENSCAD_AXI_BIN that is set but not executable fails
// loudly instead of falling through to another install.
export function findBinary(env = process.env) {
  const override = env.OPENSCAD_AXI_BIN;
  if (override) {
    if (!isExecutable(override)) {
      throw new OpenscadMissingError(
        `OPENSCAD_AXI_BIN is set to ${override} but that path is not executable`
      );
    }
    return override;
  }
  const fromPath = onPath('openscad', env);
  if (fromPath) return fromPath;
  for (const candidate of SEARCH_PATHS) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function parseVersion(text) {
  const match = /OpenSCAD version ([^\s]+)/i.exec(text || '');
  return match ? match[1] : null;
}

export function parseCapabilities(helpText) {
  const help = helpText || '';
  const backendFlag = help.includes('--backend');
  const summarySupport = help.includes('--summary');
  // The -o description lists every supported export target; `param` there means
  // native Customizer JSON export is available.
  const paramExport = /\bparam\b/.test(help) && help.includes('--export-format');
  return {
    backend_flag: backendFlag,
    summary_support: summarySupport,
    param_export: paramExport,
    backend: backendFlag ? 'manifold' : 'cgal-default',
  };
}

let probeCache = null;

// Probe result is cached in-process: every command runs at most one --version
// and one --help.
export function probe({ env = process.env, force = false } = {}) {
  if (probeCache && !force) return probeCache;
  // A misconfigured OPENSCAD_AXI_BIN is recorded rather than thrown, so doctor
  // can diagnose it and home can still orient. It never falls back to another
  // install; requireOpenscad turns this into the loud failure.
  let bin = null;
  let reason = null;
  try {
    bin = findBinary(env);
  } catch (error) {
    if (!(error instanceof OpenscadMissingError)) throw error;
    reason = error.detail;
  }
  if (!bin) {
    probeCache = {
      bin: null,
      reason,
      version: null,
      backend_flag: false,
      summary_support: false,
      param_export: false,
      backend: 'unavailable',
    };
    return probeCache;
  }
  // Some builds print the version to stderr, so read both streams.
  const versionRun = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  const helpRun = spawnSync(bin, ['--help'], { encoding: 'utf8' });
  const capabilities = parseCapabilities(`${helpRun.stdout || ''}${helpRun.stderr || ''}`);
  probeCache = {
    bin,
    reason: null,
    version: parseVersion(`${versionRun.stdout || ''}${versionRun.stderr || ''}`),
    ...capabilities,
  };
  return probeCache;
}

// Requires an OpenSCAD install; throws OpenscadMissingError when absent so the
// caller can render the standard structured error.
export function requireOpenscad(env = process.env) {
  const info = probe({ env });
  if (!info.bin) throw new OpenscadMissingError(info.reason);
  return info;
}

// Always array args, never a shell: -D values carry quotes and brackets.
export function run(bin, args, { cwd, timeoutMs } = {}) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    return { status: 1, stdout: '', stderr: String(result.error.message || result.error) };
  }
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// Renders and exports get --backend=manifold when the binary supports it.
export function backendArgs(info) {
  return info.backend_flag ? ['--backend=manifold'] : [];
}
