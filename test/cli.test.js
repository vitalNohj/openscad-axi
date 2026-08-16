// CLI surface tests: exit codes, unknown input, help, and the missing-binary
// path. These run the real entry point but never need OpenSCAD installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'openscad-axi.js');

function runCli(args, { cwd = root, env = {} } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function scratchDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-cli-'));
}

function fakeOpenscad(dir, diagnostic = '') {
  const bin = path.join(dir, 'fake-openscad');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('OpenSCAD version 2026.06.12\\n');
  process.exit(0);
}
if (args.includes('--help')) {
  process.stdout.write('--backend arg\\n--summary arg\\n--export-format arg ... param\\n');
  process.exit(0);
}
const outputIndex = args.indexOf('-o');
if (outputIndex >= 0) {
  const output = args[outputIndex + 1];
  const formatIndex = args.indexOf('--export-format');
  const format = formatIndex >= 0 ? args[formatIndex + 1] : null;
  if (format === 'asciistl') {
    fs.writeFileSync(output, 'solid fake\\nendsolid fake\\n');
  } else if (format === '3mf') {
    fs.writeFileSync(output, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  } else if (format === 'binstl') {
    const stl = Buffer.alloc(84);
    stl.writeUInt32LE(0, 80);
    fs.writeFileSync(output, stl);
  } else {
    fs.writeFileSync(output, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
}
const summaryIndex = args.indexOf('--summary-file');
if (summaryIndex >= 0) {
  fs.writeFileSync(
    args[summaryIndex + 1],
    JSON.stringify({ geometry: { simple: true, facets: 12, vertices: 8, bounding_box: { size: [1, 1, 1] } } })
  );
}
if (${JSON.stringify(diagnostic)}) process.stderr.write(${JSON.stringify(diagnostic)});
`
  );
  chmodSync(bin, 0o755);
  return bin;
}

// No binary at all: every command must still fail structurally, never crash.
const NO_BINARY = { OPENSCAD_AXI_BIN: '/nonexistent/openscad' };

test('unknown command exits 2 and lists valid commands', () => {
  const result = runCli(['frobnicate']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /error: unknown command `frobnicate`/);
  assert.match(result.stdout, /valid commands: next, validate, preview, params, export, doctor, setup/);
});

test('unknown flag exits 2 and inlines that command flag list', () => {
  const result = runCli(['export', 'x.scad', '--outpath', 'y.stl']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /error: unknown flag --outpath for `export`/);
  assert.match(result.stdout, /valid flags for `export`: --force, --format, --output, -D/);
});

test('--help works on every command and lists usage plus examples', () => {
  for (const command of ['next', 'validate', 'preview', 'params', 'export', 'doctor', 'setup']) {
    const result = runCli([command, '--help']);
    assert.equal(result.status, 0, `${command} --help must exit 0`);
    assert.match(result.stdout, /^usage: npx -y openscad-axi/m, `${command} usage line`);
    assert.match(result.stdout, /examples\[\d+\]:/, `${command} examples`);
  }
});

test('preview help tells the agent to Read every PNG', () => {
  const result = runCli(['preview', '--help']);
  assert.match(result.stdout, /Read every PNG path in the output before changing the model/);
});

test('no help line ever suggests a raw openscad command', () => {
  const outputs = [
    runCli([]).stdout,
    runCli(['--help']).stdout,
    runCli(['doctor']).stdout,
    ...['next', 'validate', 'preview', 'params', 'export', 'setup'].map(
      (command) => runCli([command, '--help']).stdout
    ),
  ];
  for (const output of outputs) {
    for (const line of output.split('\n')) {
      // A suggested command must always be the npx form.
      assert.equal(
        /`openscad /.test(line) || /`\/.*openscad/.test(line),
        false,
        `leaked raw binary in: ${line}`
      );
    }
  }
});

test('--version prints the package version', () => {
  const result = runCli(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^version: \d+\.\d+\.\d+$/m);
});

test('--json is global before commands and version output', () => {
  const doctorResult = runCli(['--json', 'doctor'], { env: NO_BINARY });
  assert.equal(doctorResult.status, 0);
  assert.equal(JSON.parse(doctorResult.stdout).doctor.openscad, 'not found');

  const versionResult = runCli(['--json', '--version']);
  assert.equal(versionResult.status, 0);
  assert.match(JSON.parse(versionResult.stdout).version, /^\d+\.\d+\.\d+$/);
});

test('home in an empty directory is a definitive empty state, exit 0', () => {
  const dir = scratchDir();
  try {
    const result = runCli([], { cwd: dir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /models: 0 \.scad files found in this directory/);
    assert.match(result.stdout, /next <name>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('home works without OpenSCAD so orientation never depends on the binary', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'box_001.scad'), 'cube([1,1,1]);\n');
    const result = runCli([], { cwd: dir, env: NO_BINARY });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /openscad: not found/);
    assert.match(result.stdout, /box,001/);
    assert.match(result.stdout, /doctor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor reports a missing binary and still exits 0', () => {
  const result = runCli(['doctor'], { env: NO_BINARY });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /openscad: not found/);
  assert.match(result.stdout, /brew install --cask openscad@snapshot/);
});

test('a missing binary is a structured error with a doctor hint, exit 1', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'box_001.scad'), 'cube([1,1,1]);\n');
    const result = runCli(['validate', 'box_001.scad'], { cwd: dir, env: NO_BINARY });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error: OpenSCAD binary not found/);
    assert.match(result.stdout, /npx -y openscad-axi doctor/);
    assert.equal(result.stdout.includes('Error:'), false, 'no raw exception text');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next answers without OpenSCAD and never errors on existing files', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'piano_002.scad'), '');
    const result = runCli(['next', 'piano'], { cwd: dir, env: NO_BINARY });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /create: piano_003\.scad/);
    assert.match(result.stdout, /latest: piano_002\.scad/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('next rejects a name that is not filename safe, exit 2', () => {
  const result = runCli(['next', '../etc/passwd']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /invalid model name/);
  assert.match(result.stdout, /\[a-z\]\[a-z0-9_\]\*/);
});

test('next requires a name', () => {
  const result = runCli(['next']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /next requires a model name/);
});

test('a missing file is a structured error, exit 1', () => {
  const dir = scratchDir();
  try {
    const result = runCli(['validate', 'nope.scad'], { cwd: dir });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error: file not found: nope\.scad/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('params falls back to comment parsing with no OpenSCAD present', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'm_001.scad'), 'width = 50; // [20:100] Width in mm\n');
    const result = runCli(['params', 'm_001.scad'], { cwd: dir, env: NO_BINARY });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /source: customizer_comments/);
    assert.match(result.stdout, /width,50,integer,"\[20:100\]",Width in mm/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('params on a model with no parameters is a definitive empty state', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'm_001.scad'), 'cube([1,1,1]);\n');
    const result = runCli(['params', 'm_001.scad'], { cwd: dir, env: NO_BINARY });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /params: 0 customizer parameters found in m_001\.scad/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--json emits a JSON envelope instead of TOON', () => {
  const dir = scratchDir();
  try {
    const result = runCli(['next', 'piano', '--json'], { cwd: dir });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.next.create, 'piano_001.scad');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export emits non_manifold for an unseparated NotManifold diagnostic', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'bad_001.scad'), 'cube([1,1,1]);\n');
    const bin = fakeOpenscad(
      dir,
      'ERROR: [manifold] NotManifold: Edge does not have exactly two incident faces\\n'
    );
    const result = runCli(['export', 'bad_001.scad', '--json'], {
      cwd: dir,
      env: { OPENSCAD_AXI_BIN: bin },
    });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.export.status, 'warning');
    assert.equal(parsed.export.manifold, false);
    assert.equal(parsed.export.geometry_dropped, true);
    assert.ok(parsed.issues.some((issue) => issue.code === 'non_manifold'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export replaces a fresh STL when the requested format changes', () => {
  const dir = scratchDir();
  try {
    const model = path.join(dir, 'cube_001.scad');
    writeFileSync(model, 'cube([1,1,1]);\n');
    const past = new Date(Date.now() - 10_000);
    utimesSync(model, past, past);
    const bin = fakeOpenscad(dir);
    const env = { OPENSCAD_AXI_BIN: bin };

    assert.equal(runCli(['export', 'cube_001.scad'], { cwd: dir, env }).status, 0);
    const ascii = runCli(['export', 'cube_001.scad', '--format', 'asciistl', '--json'], {
      cwd: dir,
      env,
    });
    assert.equal(JSON.parse(ascii.stdout).export.format, 'asciistl');
    assert.match(readFileSync(path.join(dir, 'cube_001.stl'), 'utf8'), /^solid fake/);

    const binary = runCli(['export', 'cube_001.scad', '--format', 'binstl', '--json'], {
      cwd: dir,
      env,
    });
    assert.equal(JSON.parse(binary.stdout).export.format, 'binstl');
    assert.equal(readFileSync(path.join(dir, 'cube_001.stl')).length, 84);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview --compare reports all previous PNGs with missing state', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'cube_001.scad'), 'cube([1,1,1]);\n');
    writeFileSync(path.join(dir, 'cube_002.scad'), 'cube([2,2,2]);\n');
    const previousDir = path.join(dir, 'previews', 'cube_001');
    mkdirSync(previousDir, { recursive: true });
    writeFileSync(path.join(previousDir, 'cube_001_iso.png'), 'ready');
    const bin = fakeOpenscad(dir);
    const result = runCli(['preview', 'cube_002.scad', '--compare', '--json'], {
      cwd: dir,
      env: { OPENSCAD_AXI_BIN: bin },
    });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.compare_pngs.length, 6);
    assert.equal(parsed.compare_pngs.filter((png) => png.state === 'ready').length, 1);
    assert.equal(parsed.compare_pngs.filter((png) => png.state === 'missing').length, 5);
    assert.equal(parsed.preview.status, 'warning');
    assert.ok(parsed.help.some((line) => line.includes('preview cube_001.scad')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing is written to stderr on the normal path', () => {
  const dir = scratchDir();
  try {
    const result = runCli(['next', 'piano'], { cwd: dir });
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preview rejects an unknown angle and lists the valid ones', () => {
  const result = runCli(['preview', 'x.scad', '--angle', 'diagonal']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /unknown angle `diagonal`/);
  assert.match(result.stdout, /valid angles: iso, front, back, left, right, top, all/);
});

test('export rejects an unknown format and lists the valid ones', () => {
  const result = runCli(['export', 'x.scad', '--format', 'obj']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /unknown format `obj`/);
  assert.match(result.stdout, /valid formats: binstl, asciistl, 3mf/);
});

test('setup rejects an unknown target and app', () => {
  const badTarget = runCli(['setup', 'everything']);
  assert.equal(badTarget.status, 2);
  assert.match(badTarget.stdout, /unknown setup target `everything`/);

  const badApp = runCli(['setup', 'hooks', '--app', 'emacs']);
  assert.equal(badApp.status, 2);
  assert.match(badApp.stdout, /unknown app `emacs`/);
  assert.match(badApp.stdout, /valid apps: claude-code, codex, opencode, all/);
});

test('emitted CLI surfaces contain no em dash', () => {
  const dir = scratchDir();
  try {
    const invocations = [
      [],
      ['--help'],
      ['--version'],
      ['frobnicate'],
      ['doctor'],
      ...['next', 'validate', 'preview', 'params', 'export', 'doctor', 'setup'].map((command) => [
        command,
        '--help',
      ]),
    ];
    for (const args of invocations) {
      const result = runCli(args, { cwd: dir, env: NO_BINARY });
      assert.equal(result.stdout.includes('\u2014'), false, args.join(' ') || '(home)');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
