// OpenSCAD stderr -> structured issues[]. Canonical codes:
// non_manifold, self_intersect, degenerate, warning, syntax_error.

// The manifold backend reports failures as `NotManifold` with no separator and
// as `Input mesh is not closed!`; CGAL uses `may not be a valid 2-manifold`.
const MATCHERS = [
  {
    code: 'non_manifold',
    pattern: /non-?manifold|not\s+a\s+valid\s+2-manifold|not\s+manifold|mesh is not closed/i,
  },
  { code: 'self_intersect', pattern: /self.?intersect/i },
  { code: 'degenerate', pattern: /degenerate/i },
];

// Only genuine parse failures are syntax_error; other ERROR lines fall through
// to the catch-all so a geometry failure is never mislabeled as bad syntax.
const SYNTAX_ERROR = /parser error|can't parse file|syntax error/i;

// Progress chatter OpenSCAD writes to stderr on every run. Never an issue and
// never echoed to our stdout.
const NOISE = [
  /^Compiling design/i,
  /^Normalized CSG tree/i,
  /^Geometries in cache/i,
  /^Geometry cache size/i,
  /^CGAL Polyhedrons in cache/i,
  /^CGAL cache size/i,
  /^Total rendering time/i,
  /^Rendering/i,
  /^Top level object is/i,
  /^Simple: /i,
  /^Vertices:/i,
  /^Halfedges:/i,
  /^Edges:/i,
  /^Halffacets:/i,
  /^Facets:/i,
  /^Volumes:/i,
  /^Export finished/i,
  /^Parsing design/i,
  /^Saved backup file/i,
];

function isNoise(line) {
  return NOISE.some((pattern) => pattern.test(line));
}

function splitLines(stderr) {
  return String(stderr || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function echoLines(stderr) {
  return splitLines(stderr).filter((line) => line.startsWith('ECHO:'));
}

function classify(line) {
  for (const matcher of MATCHERS) {
    if (matcher.pattern.test(line)) return matcher.code;
  }
  if (SYNTAX_ERROR.test(line)) return 'syntax_error';
  if (/^ERROR:/i.test(line) || /^WARNING:/i.test(line)) return 'warning';
  return null;
}

function stripPrefix(line) {
  return line.replace(/^(WARNING|ERROR|TRACE):\s*/i, '');
}

// Returns deduplicated issues in first-seen order.
export function parseIssues(stderr) {
  const issues = [];
  const seen = new Set();
  for (const line of splitLines(stderr)) {
    if (isNoise(line) || line.startsWith('ECHO:')) continue;
    const code = classify(line);
    if (!code) continue;
    const detail = stripPrefix(line);
    const key = `${code}::${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ code, detail });
  }
  return issues;
}

// OpenSCAD parser errors look like:
// ERROR: Parser error: syntax error in file foo.scad, line 12
export function parseErrorLocation(stderr) {
  const match = /in file ([^,]+), line (\d+)/i.exec(String(stderr || ''));
  if (!match) return null;
  return { file: match[1].trim(), line: parseInt(match[2], 10) };
}

export function firstErrorLine(stderr) {
  for (const line of splitLines(stderr)) {
    if (/^ERROR:/i.test(line)) return stripPrefix(line);
  }
  for (const line of splitLines(stderr)) {
    if (!isNoise(line) && !line.startsWith('ECHO:')) return stripPrefix(line);
  }
  return null;
}

// OpenSCAD warns when the design produces nothing; six blank PNGs otherwise
// cost the agent a whole loop.
export function hasEmptyGeometry(stderr) {
  return /top level object is empty|current top level object is empty/i.test(String(stderr || ''));
}
