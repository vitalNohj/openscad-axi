// Versioned model discovery: <name>_<NNN>.scad with 3-digit zero-padded NNN.
import { readdirSync } from 'node:fs';
import path from 'node:path';

export const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const VERSIONED = /^([a-z][a-z0-9_]*)_(\d{3})\.scad$/;

export function isValidName(name) {
  return NAME_PATTERN.test(name);
}

export function pad(n) {
  return String(n).padStart(3, '0');
}

export function parseVersioned(filename) {
  const match = VERSIONED.exec(filename);
  if (!match) return null;
  // Base 10 always: 008 and 009 are not octal.
  return { name: match[1], version: parseInt(match[2], 10), file: filename };
}

export function listScadFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.scad'))
    .map((entry) => entry.name)
    .sort();
}

// All versions of one model name, ascending.
export function versionsFor(dir, name) {
  return listScadFiles(dir)
    .map(parseVersioned)
    .filter((parsed) => parsed && parsed.name === name)
    .sort((a, b) => a.version - b.version);
}

export function nextVersion(dir, name) {
  const versions = versionsFor(dir, name);
  const latest = versions.length ? versions[versions.length - 1] : null;
  const nextNumber = latest ? latest.version + 1 : 1;
  return {
    name,
    latest: latest ? latest.file : null,
    latestVersion: latest ? latest.version : null,
    create: `${name}_${pad(nextNumber)}.scad`,
    createVersion: nextNumber,
  };
}

// Groups every versioned .scad in dir by model name; loose files are the
// non-versioned remainder.
export function groupModels(dir) {
  const files = listScadFiles(dir);
  const groups = new Map();
  const loose = [];
  for (const file of files) {
    const parsed = parseVersioned(file);
    if (!parsed) {
      loose.push(file);
      continue;
    }
    if (!groups.has(parsed.name)) groups.set(parsed.name, []);
    groups.get(parsed.name).push(parsed);
  }
  const models = [...groups.entries()]
    .map(([name, versions]) => {
      versions.sort((a, b) => a.version - b.version);
      return { name, versions, latest: versions[versions.length - 1] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { models, loose };
}

export function stemOf(file) {
  return path.basename(file, '.scad');
}

// The previous version's .scad for --compare, or null at 001.
export function previousVersionFile(dir, file) {
  const parsed = parseVersioned(path.basename(file));
  if (!parsed) return null;
  const versions = versionsFor(dir, parsed.name).filter((v) => v.version < parsed.version);
  return versions.length ? versions[versions.length - 1].file : null;
}
