// CLI surface tests: exit codes, unknown input, help, and the missing-binary
// path. These run the real entry point but never need OpenSCAD installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
