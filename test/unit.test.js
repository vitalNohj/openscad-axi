// Unit tests. These must pass with no OpenSCAD installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeToon } from '../src/toon.js';
import { nextVersion, parseVersioned, groupModels, previousVersionFile } from '../src/lib/versions.js';
import { parseIssues, parseErrorLocation, firstErrorLine, hasEmptyGeometry } from '../src/lib/warnings.js';
import { geometryFacts, readSummary, trianglesFromBinaryStl } from '../src/lib/summary.js';
import { extractParams, translateNativeParams } from '../src/lib/customizer.js';
import { parseArgs, parseDefines, UsageError } from '../src/lib/args.js';
import { parseCapabilities, parseVersion } from '../src/openscad.js';
import { parseSize, ANGLE_NAMES } from '../src/lib/cameras.js';
import { installHooks } from '../src/commands/setup.js';
import { renderSkill } from '../scripts/gen-skill.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function scratchDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'openscad-axi-test-'));
}

test('toon: scalars and nesting', () => {
  assert.equal(encodeToon({ a: 1, b: { c: 'x' } }), 'a: 1\nb:\n  c: x');
});

test('toon: tabular uniform object arrays', () => {
  const out = encodeToon({ rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
  assert.equal(out, 'rows[2]{id,name}:\n  1,a\n  2,b');
});

test('toon: quotes cells with commas, colons, and quotes', () => {
  const out = encodeToon({ rows: [{ v: 'a,b' }, { v: 'k: v' }, { v: 'say "hi"' }] });
  assert.match(out, /"a,b"/);
  assert.match(out, /"k: v"/);
  assert.match(out, /"say \\"hi\\""/);
});

test('toon: numeric tuples stay inline, scalar lists are per-line', () => {
  assert.equal(encodeToon({ size_mm: [1, 2.5, 3] }), 'size_mm: [1,2.5,3]');
  assert.equal(encodeToon({ help: ['one', 'two'] }), 'help[2]:\n  one\n  two');
});

test('versions: empty dir starts at 001', () => {
  const dir = scratchDir();
  try {
    assert.equal(nextVersion(dir, 'piano').create, 'piano_001.scad');
    assert.equal(nextVersion(dir, 'piano').latest, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('versions: gaps take max plus one, not count plus one', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'piano_001.scad'), '');
    writeFileSync(path.join(dir, 'piano_003.scad'), '');
    const result = nextVersion(dir, 'piano');
    assert.equal(result.create, 'piano_004.scad');
    assert.equal(result.latest, 'piano_003.scad');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('versions: 009 increments to 010 in base 10', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'piano_009.scad'), '');
    assert.equal(nextVersion(dir, 'piano').create, 'piano_010.scad');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('versions: ignores non three-digit suffixes', () => {
  assert.equal(parseVersioned('foo_1.scad'), null);
  assert.equal(parseVersioned('foo_0001.scad'), null);
  assert.deepEqual(parseVersioned('foo_007.scad'), { name: 'foo', version: 7, file: 'foo_007.scad' });
});

test('versions: groups models and separates loose files', () => {
  const dir = scratchDir();
  try {
    writeFileSync(path.join(dir, 'box_001.scad'), '');
    writeFileSync(path.join(dir, 'box_002.scad'), '');
    writeFileSync(path.join(dir, 'sketch.scad'), '');
    const { models, loose } = groupModels(dir);
    assert.equal(models.length, 1);
    assert.equal(models[0].latest.file, 'box_002.scad');
    assert.deepEqual(loose, ['sketch.scad']);
    assert.equal(previousVersionFile(dir, 'box_002.scad'), 'box_001.scad');
    assert.equal(previousVersionFile(dir, 'box_001.scad'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('warnings: maps each pattern to its code', () => {
  const stderr = [
    'WARNING: Object may not be a valid 2-manifold and may need repair!',
    'ERROR: [manifold] Input mesh is not closed!',
    'WARNING: Self-intersecting geometry detected',
    'WARNING: degenerate facet removed',
    'WARNING: Ignoring unknown variable',
  ].join('\n');
  const codes = parseIssues(stderr).map((issue) => issue.code);
  assert.ok(codes.includes('non_manifold'));
  assert.ok(codes.includes('self_intersect'));
  assert.ok(codes.includes('degenerate'));
  assert.ok(codes.includes('warning'));
});

test('warnings: quiet stderr yields no issues', () => {
  assert.deepEqual(parseIssues(''), []);
});

test('warnings: progress noise is never an issue', () => {
  const noise = [
    'Compiling design (CSG Products normalization)...',
    'Normalized CSG tree has 1 elements',
    'Geometries in cache: 1',
    'Total rendering time: 0:00:00.189',
  ].join('\n');
  assert.deepEqual(parseIssues(noise), []);
});

test('warnings: parse errors carry file and line', () => {
  const stderr = 'ERROR: Parser error: syntax error in file syn.scad, line 12';
  assert.deepEqual(parseErrorLocation(stderr), { file: 'syn.scad', line: 12 });
  assert.equal(parseIssues(stderr)[0].code, 'syntax_error');
  assert.match(firstErrorLine(stderr), /Parser error/);
});

test('warnings: geometry failures are not mislabeled as syntax errors', () => {
  assert.equal(parseIssues('ERROR: [manifold] Input mesh is not closed!')[0].code, 'non_manifold');
});

test('warnings: detects empty top level geometry', () => {
  assert.equal(hasEmptyGeometry('Current top level object is empty.'), true);
  assert.equal(hasEmptyGeometry('Total rendering time: 0:00:00.1'), false);
});

test('summary: manifold geometry reports true with facets and size', () => {
  const summary = readSummary(
    JSON.stringify({
      geometry: {
        simple: true,
        facets: 32,
        vertices: 16,
        bounding_box: { size: [10.005, 20, 30] },
      },
    })
  );
  const facts = geometryFacts(summary);
  assert.equal(facts.manifold, true);
  assert.equal(facts.triangles, 32);
  assert.deepEqual(facts.size_mm, [10.01, 20, 30]);
});

test('summary: simple false reports false', () => {
  assert.equal(geometryFacts({ geometry: { simple: false, facets: 4 } }).manifold, false);
});

test('summary: missing geometry key is unknown, never ok', () => {
  assert.equal(geometryFacts({}).manifold, 'unknown');
  assert.equal(geometryFacts(null).manifold, 'unknown');
  // A PolySet summary has convex/triangular but no `simple`, so it cannot claim manifold.
  assert.equal(geometryFacts({ geometry: { convex: true, triangular: true } }).manifold, 'unknown');
});

test('summary: invalid JSON is null, not a throw', () => {
  assert.equal(readSummary('not json'), null);
});

test('summary: binary STL triangle count reads uint32 LE at offset 80', () => {
  const buffer = Buffer.alloc(84);
  buffer.writeUInt32LE(18422, 80);
  assert.equal(trianglesFromBinaryStl(buffer), 18422);
  assert.equal(trianglesFromBinaryStl(Buffer.alloc(10)), null);
});

test('customizer: extracts parametric_box params with types and constraints', () => {
  const source = readFileSync(path.join(fixtures, 'parametric_box.scad'), 'utf8');
  const params = extractParams(source);
  assert.equal(params.length, 9, 'nine parameters, $fn is not a Customizer parameter');
  const byName = Object.fromEntries(params.map((param) => [param.name, param]));
  assert.deepEqual(
    { value: byName.width.value, type: byName.width.type, constraint: byName.width.constraint },
    { value: '60', type: 'integer', constraint: '[20:200]' }
  );
  assert.equal(byName.width.description, 'Width in mm');
  assert.equal(byName.wall_thickness.constraint, '[1:0.5:5]');
  assert.equal(byName.lid_tolerance.type, 'number');
  assert.equal(byName.include_lid.type, 'boolean');
  assert.equal(byName.add_grip.value, 'true');
  assert.equal(byName.$fn, undefined);
});

test('customizer: skips assignments inside module bodies', () => {
  const params = extractParams('a = 1;\nmodule m() {\n  b = 2;\n}\nc = 3;\n');
  assert.deepEqual(params.map((param) => param.name), ['a', 'c']);
});

test('customizer: infers types from literal shape', () => {
  const params = extractParams('i = 5;\nf = 1.5;\ns = "x";\nv = [1,2];\ne = 2 * 3;\n');
  assert.deepEqual(params.map((param) => param.type), [
    'integer',
    'number',
    'string',
    'array',
    'expression',
  ]);
  assert.equal(params[2].value, 'x');
});

test('customizer: translates native param export and drops special variables', () => {
  const rows = translateNativeParams({
    parameters: [
      { name: 'w', type: 'number', initial: 60, min: 20, max: 200, step: 1, caption: 'Width' },
      { name: 't', type: 'number', initial: 2, min: 1, max: 5, step: 0.5 },
      { name: 'on', type: 'boolean', initial: true },
      { name: 'mode', type: 'string', initial: 'a', options: [{ value: 'a' }, { value: 'b' }] },
      { name: '$fn', type: 'number', initial: 32 },
    ],
  });
  assert.deepEqual(rows.map((row) => row.name), ['w', 't', 'on', 'mode']);
  assert.equal(rows[0].constraint, '[20:200]');
  assert.equal(rows[0].type, 'integer');
  assert.equal(rows[1].constraint, '[1:0.5:5]');
  assert.equal(rows[1].type, 'number');
  assert.equal(rows[3].constraint, '[a,b]');
});

test('args: unknown flag is rejected by name with the valid flags inlined', () => {
  const spec = { '--angle': { type: 'value' }, '--compare': { type: 'boolean' } };
  assert.throws(
    () => parseArgs(['--anglez', 'iso'], spec, 'preview'),
    (error) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /unknown flag --anglez for `preview`/);
      assert.match(error.help[0], /--angle, --compare/);
      return true;
    }
  );
});

test('args: renamed flags get a targeted hint instead of the generic list', () => {
  assert.throws(
    () => parseArgs(['--out-dir', 'x'], { '--out': { type: 'value' } }, 'preview'),
    (error) => {
      assert.match(error.help[0], /--out-dir was renamed; use --out instead/);
      return true;
    }
  );
});

test('args: --help and --json pass on every command', () => {
  const parsed = parseArgs(['--help', '--json'], {}, 'doctor');
  assert.equal(parsed.help, true);
  assert.equal(parsed.json, true);
});

test('args: repeatable and inline-value flags', () => {
  const spec = { '-D': { type: 'repeat' }, '--size': { type: 'value' } };
  const parsed = parseArgs(['-D', 'a=1', '-D', 'b=2', '--size=800x600', 'file.scad'], spec, 'preview');
  assert.deepEqual(parsed.flags['-D'], ['a=1', 'b=2']);
  assert.equal(parsed.flags['--size'], '800x600');
  assert.deepEqual(parsed.positional, ['file.scad']);
});

test('args: a flag missing its value is a usage error', () => {
  assert.throws(() => parseArgs(['--size'], { '--size': { type: 'value' } }, 'preview'), UsageError);
});

test('args: -D values must be var=value', () => {
  assert.deepEqual(parseDefines(['w=80'], 'export'), ['w=80']);
  assert.throws(() => parseDefines(['w'], 'export'), UsageError);
});

test('openscad: parses version and capabilities from help text', () => {
  assert.equal(parseVersion('OpenSCAD version 2026.06.12'), '2026.06.12');
  assert.equal(parseVersion('no version here'), null);

  const modern = parseCapabilities('--backend arg\n--summary arg\n--export-format arg ... param, pov');
  assert.deepEqual(modern, {
    backend_flag: true,
    summary_support: true,
    param_export: true,
    backend: 'manifold',
  });

  const legacy = parseCapabilities('-o arg\n--imgsize arg');
  assert.equal(legacy.backend_flag, false);
  assert.equal(legacy.summary_support, false);
  assert.equal(legacy.backend, 'cgal-default');
});

test('cameras: six named angles and size parsing', () => {
  assert.deepEqual(ANGLE_NAMES, ['iso', 'front', 'back', 'left', 'right', 'top']);
  assert.deepEqual(parseSize('800x600'), { width: 800, height: 600, text: '800x600' });
  assert.equal(parseSize('800'), null);
  assert.equal(parseSize('0x600'), null);
});

test('setup hooks: installs, is idempotent, and repairs a stale path', () => {
  const home = scratchDir();
  const apps = ['claude-code', 'codex', 'opencode'];
  const oldBin = '/old/prefix/bin/openscad-axi';
  const newBin = '/new/prefix/bin/openscad-axi';
  try {
    const first = installHooks({ apps, bin: oldBin, homeDir: home });
    assert.deepEqual(first.results.map((r) => r.state), ['installed', 'installed', 'installed']);

    // Three runs total, matching the release-gate check.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repeat = installHooks({ apps, bin: oldBin, homeDir: home });
      assert.deepEqual(repeat.results.map((r) => r.state), ['unchanged', 'unchanged', 'unchanged']);
    }

    const moved = installHooks({ apps, bin: newBin, homeDir: home });
    assert.deepEqual(moved.results.map((r) => r.state), ['repaired', 'repaired', 'repaired']);

    const settings = JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.hooks.SessionStart.length, 1, 'repair must not append a duplicate entry');
    assert.equal(settings.hooks.SessionStart[0].hooks[0].command, `${newBin} || true`);

    const codexConfig = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[features\][\s\S]*hooks = true/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('setup hooks: preserves unrelated existing settings', () => {
  const home = scratchDir();
  try {
    const settingsFile = path.join(home, '.claude', 'settings.json');
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(
      settingsFile,
      JSON.stringify({ model: 'custom', hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool' }] }] } }, null, 2)
    );

    installHooks({ apps: ['claude-code'], bin: '/prefix/bin/openscad-axi', homeDir: home });

    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    assert.equal(settings.model, 'custom', 'unrelated keys survive');
    assert.equal(settings.hooks.SessionStart.length, 2, 'another tool\'s hook is preserved');
    assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'other-tool');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('gen-skill: committed skill matches the generated output', () => {
  const committed = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'SKILL.md'),
    'utf8'
  );
  assert.equal(committed, renderSkill(), 'run `npm run gen-skill` and commit the result');
});

test('no em dash in user-facing copy', async () => {
  const strings = await import('../src/strings.js');
  const text = JSON.stringify(strings);
  assert.equal(text.includes('\u2014'), false);
  const skill = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'SKILL.md'),
    'utf8'
  );
  assert.equal(skill.includes('\u2014'), false);
});
