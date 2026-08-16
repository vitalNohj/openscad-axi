// JSON -> TOON encoder. Used only at the output boundary.
// Spec: https://toonformat.dev/reference/spec.html
// Subset emitted by this CLI: scalars with 2-space nesting, tabular uniform
// object arrays, scalar-item lists.

const INDENT = '  ';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return String(value);
}

// A cell needs quoting when it contains the delimiter, a colon, quotes, a
// newline, or has significant leading/trailing whitespace.
export function quoteCell(value) {
  const text = formatScalar(value);
  if (text === '') return '';
  const needsQuote =
    text.includes(',') ||
    text.includes(':') ||
    text.includes('"') ||
    text.includes('\n') ||
    text !== text.trim();
  if (!needsQuote) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

// A bare scalar on a `key: value` line only needs quoting when it would break
// the line or start/end with whitespace. Colons and commas are unambiguous
// after the first `: `.
function quoteValue(value) {
  const text = formatScalar(value);
  if (text === '') return '';
  if (text.includes('\n') || text !== text.trim() || text.startsWith('"')) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return text;
}

function isTabular(items) {
  if (items.length === 0) return false;
  if (!items.every(isPlainObject)) return false;
  const keys = Object.keys(items[0]);
  if (keys.length === 0) return false;
  return items.every((item) => {
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== keys.length) return false;
    if (!keys.every((k, i) => itemKeys[i] === k)) return false;
    return keys.every((k) => !isPlainObject(item[k]) && !Array.isArray(item[k]));
  });
}

function encodeArray(key, items, depth, lines) {
  const pad = INDENT.repeat(depth);
  if (isTabular(items)) {
    const fields = Object.keys(items[0]);
    lines.push(`${pad}${key}[${items.length}]{${fields.join(',')}}:`);
    for (const item of items) {
      lines.push(`${pad}${INDENT}${fields.map((f) => quoteCell(item[f])).join(',')}`);
    }
    return;
  }
  if (items.every((item) => typeof item === 'number')) {
    // Numeric tuples (dimensions, sizes) stay inline: `size_mm: [x,y,z]`.
    lines.push(`${pad}${key}: [${items.map((i) => quoteCell(i)).join(',')}]`);
    return;
  }
  if (items.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
    // Scalar-item list: `name[N]:` then one item per line.
    lines.push(`${pad}${key}[${items.length}]:`);
    for (const item of items) {
      lines.push(`${pad}${INDENT}${formatScalar(item)}`);
    }
    return;
  }
  // Non-uniform object array: emit each item as an indented block.
  lines.push(`${pad}${key}[${items.length}]:`);
  for (const item of items) {
    encodeValue('-', item, depth + 1, lines);
  }
}

function encodeValue(key, value, depth, lines) {
  const pad = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    encodeArray(key, value, depth, lines);
    return;
  }
  if (isPlainObject(value)) {
    lines.push(`${pad}${key}:`);
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue === undefined) continue;
      encodeValue(childKey, childValue, depth + 1, lines);
    }
    return;
  }
  lines.push(`${pad}${key}: ${quoteValue(value)}`);
}

export function encodeToon(data) {
  if (!isPlainObject(data)) throw new TypeError('encodeToon expects a plain object');
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    encodeValue(key, value, 0, lines);
  }
  return lines.join('\n');
}
