// Output boundary: everything the agent consumes goes to stdout, TOON-encoded
// unless --json is set. OpenSCAD's own noise never reaches this path.
import path from 'node:path';
import os from 'node:os';
import { encodeToon } from '../toon.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

export function collapseHome(target) {
  const home = os.homedir();
  if (home && target.startsWith(home)) return `~${target.slice(home.length)}`;
  return target;
}

export function binPath() {
  return collapseHome(path.resolve(process.argv[1] || 'openscad-axi'));
}

export function emit(payload, { json = false, stream = process.stdout } = {}) {
  const text = json ? JSON.stringify(payload, null, 2) : encodeToon(payload);
  stream.write(`${text}\n`);
}

export function emitError(message, help, { json = false, stream = process.stdout, detail } = {}) {
  const payload = { error: message };
  if (detail) payload.detail = detail;
  const helpLines = Array.isArray(help) ? help : help ? [help] : [];
  if (helpLines.length) payload.help = helpLines;
  emit(payload, { json, stream });
}

// Truncate long text and always report the true total so the agent knows how
// much it is missing.
export function truncate(text, limit = 500) {
  const value = String(text || '');
  if (value.length <= limit) return { text: value, truncated: false, total: value.length };
  return { text: value.slice(0, limit), truncated: true, total: value.length };
}

export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
