// Integration tests against a real OpenSCAD install.
// Skipped with a clear message when the binary is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBinary } from '../src/openscad.js';
import { ANGLE_NAMES } from '../src/lib/cameras.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cli = path.join(root, 'bin', 'openscad-axi.js');
const fixtures = path.join(here, 'fixtures');

// A misconfigured OPENSCAD_AXI_BIN throws rather than falling back, which for
// this suite means the same thing as absent: there is nothing to test against.
function locateBinary() {
  try {
    return findBinary();
  } catch {
    return null;
  }
}

const binary = locateBinary();
const skip = binary
  ? false
  : 'OpenSCAD is not installed, so integration tests are skipped. Install it with `brew install --cask openscad@snapshot` to run them.';

function runCli(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Routes the CLI through a shim that hides --backend and --summary, so the
// pre-2026 fallback path is exercised against real geometry.
const LEGACY_ENV = {
  OPENSCAD_AXI_BIN: path.join(fixtures, 'legacy-openscad.sh'),
  OPENSCAD_AXI_REAL_BIN: binary || '',
};

// Each test gets its own directory seeded with the named fixtures.
function workspace(seed = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-int-'));
  for (const [target, fixture] of Object.entries(seed)) {
    copyFileSync(path.join(fixtures, fixture), path.join(dir, target));
  }
  return dir;
}

test('validate accepts a clean model', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['validate', 'cube_001.scad'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /status: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validate reports a syntax error with its line number, exit 1', { skip }, () => {
  const dir = workspace({ 'syn_001.scad': 'syntax_error.scad' });
  try {
    const result = runCli(['validate', 'syn_001.scad'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /status: error/);
    assert.match(result.stdout, /line: 1/);
    // OpenSCAD's own chatter must never reach our stdout.
    assert.equal(result.stdout.includes('Compiling design'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview writes all six PNGs and lists every path', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['preview', 'cube_001.scad', '--size', '200x150'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pngs\[6\]\{angle,path\}:/);
    for (const angle of ANGLE_NAMES) {
      const png = path.join(dir, 'previews', 'cube_001', `cube_001_${angle}.png`);
      assert.ok(existsSync(png), `${angle} PNG must exist`);
      assert.ok(statSync(png).size > 0, `${angle} PNG must not be empty`);
      assert.match(result.stdout, new RegExp(`${angle},previews/cube_001/cube_001_${angle}\\.png`));
    }
    assert.match(result.stdout, /Read every PNG path above/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview --angle renders one view only', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['preview', 'cube_001.scad', '--angle', 'iso', '--size', '200x150'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pngs\[1\]\{angle,path\}:/);
    assert.ok(existsSync(path.join(dir, 'previews', 'cube_001', 'cube_001_iso.png')));
    assert.equal(existsSync(path.join(dir, 'previews', 'cube_001', 'cube_001_top.png')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export reports ok, manifold, triangles, and plausible size_mm', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['export', 'cube_001.scad', '--json'], dir);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout).export;
    assert.equal(payload.status, 'ok');
    assert.equal(payload.manifold, true);
    assert.equal(payload.validation, 'geometry_summary');
    assert.equal(payload.format, 'binstl');
    assert.ok(payload.triangles > 0, 'triangle count must be reported');
    // The fixture is a 10mm cube.
    assert.deepEqual(payload.size_mm, [10, 10, 10]);
    assert.ok(existsSync(path.join(dir, 'cube_001.stl')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export uses the manifold backend when the binary supports it', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const help = spawnSync(binary, ['--help'], { encoding: 'utf8' });
    const supportsBackend = `${help.stdout}${help.stderr}`.includes('--backend');
    const payload = JSON.parse(runCli(['export', 'cube_001.scad', '--json'], dir).stdout).export;
    assert.equal(payload.backend, supportsBackend ? 'manifold' : 'cgal-default');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export never claims ok for a non-manifold model', { skip }, () => {
  const dir = workspace({ 'bad_001.scad': 'bad_nonmanifold.scad' });
  try {
    const result = runCli(['export', 'bad_001.scad', '--json'], dir);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.export.status, 'warning');
    assert.notEqual(parsed.export.manifold, true);
    assert.ok(
      parsed.issues.some((issue) => issue.code === 'non_manifold'),
      'a non_manifold issue must be reported'
    );
    assert.ok(
      parsed.help.some((line) => line.includes('closed solids')),
      'the fix hint must be present'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export is idempotent and --force re-runs it', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    assert.equal(runCli(['export', 'cube_001.scad'], dir).status, 0);
    const stl = path.join(dir, 'cube_001.stl');
    const firstMtime = statSync(stl).mtimeMs;

    const second = runCli(['export', 'cube_001.scad'], dir);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already up to date \(no-op\)/);
    assert.equal(statSync(stl).mtimeMs, firstMtime, 'a no-op must not rewrite the file');

    const forced = runCli(['export', 'cube_001.scad', '--force'], dir);
    assert.equal(forced.status, 0);
    assert.match(forced.stdout, /status: ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export re-runs when the model is newer than the output', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    runCli(['export', 'cube_001.scad'], dir);
    const future = new Date(Date.now() + 10_000);
    utimesSync(path.join(dir, 'cube_001.scad'), future, future);
    const result = runCli(['export', 'cube_001.scad'], dir);
    assert.match(result.stdout, /status: ok/);
    assert.equal(result.stdout.includes('no-op'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('-D overrides a parameter and changes the exported size', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const payload = JSON.parse(
      runCli(['export', 'cube_001.scad', '-D', 'size=20', '--json'], dir).stdout
    ).export;
    assert.deepEqual(payload.size_mm, [20, 20, 20]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('params reads real Customizer metadata from the fixtures', { skip }, () => {
  const dir = workspace({ 'box_001.scad': 'parametric_box.scad' });
  try {
    const result = runCli(['params', 'box_001.scad'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /width,60,integer,"\[20:200\]"/);
    assert.match(result.stdout, /wall_thickness,2,integer,"\[1:0\.5:5\]"/);
    assert.match(result.stdout, /include_lid,true,boolean/);
    assert.equal(result.stdout.includes('$fn'), false, '$fn is not a Customizer parameter');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('params on the phone_stand fixture matches its documented values', { skip }, () => {
  const dir = workspace({ 'stand_001.scad': 'phone_stand.scad' });
  try {
    const result = runCli(['params', 'stand_001.scad', '--json'], dir);
    const byName = Object.fromEntries(
      JSON.parse(result.stdout).params.map((param) => [param.name, param])
    );
    assert.equal(byName.device_width.value, '80');
    assert.equal(byName.device_width.constraint, '[50:200]');
    assert.equal(byName.stand_angle.value, '65');
    assert.equal(byName.material_thickness.constraint, '[2:0.5:8]');
    assert.equal(byName.cable_hole.type, 'boolean');
    assert.equal(byName.add_feet.value, 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the full loop runs end to end on a real model', { skip }, () => {
  const dir = workspace({ 'stand_001.scad': 'phone_stand.scad' });
  try {
    assert.match(runCli(['next', 'stand'], dir).stdout, /create: stand_002\.scad/);
    assert.match(runCli(['validate', 'stand_001.scad'], dir).stdout, /status: (ok|warning)/);
    assert.equal(runCli(['preview', 'stand_001.scad', '--size', '200x150'], dir).status, 0);

    const exported = JSON.parse(runCli(['export', 'stand_001.scad', '--json'], dir).stdout).export;
    assert.equal(exported.status, 'ok');
    assert.equal(exported.manifold, true);

    const home = runCli([], dir);
    assert.match(home.stdout, /stand,001,6\/6,stand_001\.stl,ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('home derives needs_preview and needs_export from mtimes', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    assert.match(runCli([], dir).stdout, /cube,001,0\/6,missing,needs_preview/);

    runCli(['preview', 'cube_001.scad', '--size', '200x150'], dir);
    assert.match(runCli([], dir).stdout, /cube,001,6\/6,missing,needs_export/);

    runCli(['export', 'cube_001.scad'], dir);
    assert.match(runCli([], dir).stdout, /cube,001,6\/6,cube_001\.stl,ok/);

    // Touching the source invalidates both artifacts.
    const future = new Date(Date.now() + 10_000);
    utimesSync(path.join(dir, 'cube_001.scad'), future, future);
    assert.match(runCli([], dir).stdout, /cube,001,6\/6,cube_001\.stl,needs_preview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview --compare lists the previous version PNGs', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad', 'cube_002.scad': 'cube_001.scad' });
  try {
    runCli(['preview', 'cube_001.scad', '--size', '200x150'], dir);
    const result = runCli(['preview', 'cube_002.scad', '--compare', '--size', '200x150'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /compared_to: previews\/cube_001/);
    assert.match(result.stdout, /compare_pngs\[6\]\{angle,path\}:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an old build without --summary reports unknown, never ok', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['export', 'cube_001.scad', '--json'], dir, LEGACY_ENV);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    // Quiet stderr must never be promoted to a pass.
    assert.equal(parsed.export.status, 'unknown');
    assert.equal(parsed.export.manifold, 'unknown');
    assert.equal(parsed.export.validation, 'openscad_stderr');
    assert.equal(parsed.export.backend, 'cgal-default');
    // Triangles still come from the binary STL header on this path.
    assert.ok(parsed.export.triangles > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor reports degraded capabilities for an old build, exit 0', { skip }, () => {
  const result = runCli(['doctor'], root, LEGACY_ENV);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /version: 2021\.01/);
  assert.match(result.stdout, /backend: cgal-default/);
  assert.match(result.stdout, /summary_support: false/);
  assert.match(result.stdout, /brew install --cask openscad@snapshot/);
});

test('params falls back to comments when native export is unavailable', { skip }, () => {
  const dir = workspace({ 'box_001.scad': 'parametric_box.scad' });
  try {
    const result = runCli(['params', 'box_001.scad'], dir, LEGACY_ENV);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /source: customizer_comments/);
    assert.match(result.stdout, /width,60,integer,"\[20:200\]"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview still renders on a build without the backend flag', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['preview', 'cube_001.scad', '--angle', 'iso', '--size', '200x150'], dir, LEGACY_ENV);
    assert.equal(result.status, 0);
    assert.ok(existsSync(path.join(dir, 'previews', 'cube_001', 'cube_001_iso.png')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview --compare on a first version says so instead of failing', { skip }, () => {
  const dir = workspace({ 'cube_001.scad': 'cube_001.scad' });
  try {
    const result = runCli(['preview', 'cube_001.scad', '--compare', '--size', '200x150'], dir);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /compared_to: none \(this is the first version\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
