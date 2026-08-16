// Customizer parameter extraction.
// Fallback path: JS port of mitsuhiko/agent-stuff extract-params.sh, preserving
// its exact rules (depth-0 assignments only, same regex, same type inference).
// Primary path: OpenSCAD's own `--export-format param` JSON, translated below.

// Leading `$` is deliberately excluded, so special variables such as $fn are
// not reported as Customizer parameters.
const LINE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?/;

function inferType(rawValue) {
  const value = rawValue.trim();
  if (value === 'true' || value === 'false') return { type: 'boolean', value };
  if (/^-?\d+$/.test(value)) return { type: 'integer', value };
  if (/^-?\d*\.?\d+$/.test(value)) return { type: 'number', value };
  if (/^"(.*)"$/.test(value)) return { type: 'string', value: value.slice(1, -1) };
  if (value.startsWith('[')) return { type: 'array', value };
  return { type: 'expression', value };
}

// Comment forms: `[min:max]`, `[min:step:max]`, `[opt1,opt2]`, plain text.
// A bracket with a colon and no comma is a range; anything else in brackets is
// an option list. Text after the bracket is the description.
function parseComment(comment) {
  if (!comment) return { constraint: '', description: '' };
  const text = comment.trim();
  const match = /^\[([^\]]*)\]\s*(.*)$/.exec(text);
  if (!match) return { constraint: '', description: text };
  const inner = match[1];
  const kind = inner.includes(':') && !inner.includes(',') ? 'range' : 'options';
  return { constraint: `[${inner}]`, constraintKind: kind, description: match[2].trim() };
}

// Brace depth is tracked with the same naive per-line count as upstream, so
// parameters inside modules are skipped and only depth-0 lines qualify.
export function extractParams(source) {
  const params = [];
  let depth = 0;
  for (const line of String(source || '').split('\n')) {
    const currentDepth = depth;
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
    if (currentDepth !== 0) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const [, name, rawValue, comment] = match;
    const { type, value } = inferType(rawValue);
    const { constraint, description } = parseComment(comment);
    params.push({ name, value, type, constraint, description });
  }
  return params;
}

function nativeType(entry) {
  if (entry.type === 'boolean') return 'boolean';
  if (entry.type === 'string') return 'string';
  if (entry.type === 'vector') return 'array';
  if (entry.type === 'number') {
    return Number.isInteger(entry.initial) && (entry.step === undefined || Number.isInteger(entry.step))
      ? 'integer'
      : 'number';
  }
  return 'expression';
}

function nativeConstraint(entry) {
  if (Array.isArray(entry.options) && entry.options.length) {
    return `[${entry.options.map((option) => option.value).join(',')}]`;
  }
  const hasRange = entry.min !== undefined && entry.max !== undefined;
  if (!hasRange) return '';
  const step = entry.step;
  const parts = step !== undefined && step !== 1 ? [entry.min, step, entry.max] : [entry.min, entry.max];
  return `[${parts.join(':')}]`;
}

function formatValue(value) {
  if (Array.isArray(value)) return `[${value.join(',')}]`;
  return String(value);
}

// Translates OpenSCAD's native param export into the same rows the fallback
// extractor produces.
export function translateNativeParams(json) {
  const entries = json && Array.isArray(json.parameters) ? json.parameters : [];
  // OpenSCAD exports special variables such as $fn; they are not Customizer
  // parameters, and the comment extractor already excludes them.
  return entries
    .filter((entry) => typeof entry.name === 'string' && !entry.name.startsWith('$'))
    .map((entry) => ({
      name: entry.name,
      value: formatValue(entry.initial),
      type: nativeType(entry),
      constraint: nativeConstraint(entry),
      description: entry.caption || '',
    }));
}
