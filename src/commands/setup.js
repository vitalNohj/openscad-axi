import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onPath } from '../openscad.js';
import { UsageError } from '../lib/args.js';
import { emit, EXIT_OK } from '../lib/output.js';
import { CODEX_HOOK_TRUST_NOTE, NPX } from '../strings.js';

const APPS = ['claude-code', 'codex', 'opencode'];

export const spec = {
  '--app': { type: 'value' },
};

export const help = {
  usage: `${NPX} setup hooks [--app <claude-code|codex|opencode|all>]`,
  summary: 'Install the SessionStart dashboard hook into supported agent harnesses',
  flags: [`--app  ${APPS.join('|')}|all (default all)`],
  examples: [`${NPX} setup hooks`, `${NPX} setup hooks --app claude-code`],
};

const MARKER = 'openscad-axi';

// A PATH-resolved `openscad-axi` is preferred so global installs stay portable;
// it is only used when it resolves to this very executable.
export function resolveHookCommand(env = process.env) {
  const self = path.resolve(process.argv[1] || '');
  const resolved = onPath('openscad-axi', env);
  if (resolved && path.resolve(resolved) === self) return 'openscad-axi';
  return self || 'openscad-axi';
}

function readJson(file) {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object at the top level');
    }
    return parsed;
  } catch (error) {
    throw new Error(`cannot update ${file}: ${error.message}`);
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hookCommandText(bin) {
  // `|| true` keeps a session from failing when the dashboard cannot run.
  const command = bin === 'openscad-axi' ? bin : `'${String(bin).replace(/'/g, `'\\''`)}'`;
  return `${command} || true`;
}

// Shared SessionStart merge for the two JSON-configured harnesses.
function installSessionStartHook(file, bin) {
  const config = readJson(file);
  const command = hookCommandText(bin);
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
  if (!Array.isArray(config.hooks.SessionStart)) config.hooks.SessionStart = [];

  for (const entry of config.hooks.SessionStart) {
    const hooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    for (const hook of hooks) {
      if (typeof hook.command !== 'string' || !hook.command.includes(MARKER)) continue;
      if (hook.command === command) return { state: 'unchanged', file };
      hook.command = command;
      writeJson(file, config);
      return { state: 'repaired', file };
    }
  }

  config.hooks.SessionStart.push({ matcher: '', hooks: [{ type: 'command', command }] });
  writeJson(file, config);
  return { state: 'installed', file };
}

function ensureCodexHooksFeature(configFile) {
  const text = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
  const lines = text.split('\n');
  const dottedKey = /^(\s*features\s*\.\s*hooks\s*=\s*)(true|false)(\s*(?:#.*)?)$/;
  const dottedAssignment = /^\s*features\s*\.\s*hooks\s*=/;
  const tableHeader = /^\s*\[features\]\s*(?:#.*)?$/;
  const anyTableHeader = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/;
  const hooksKey = /^(\s*hooks\s*=\s*)(true|false)(\s*(?:#.*)?)$/;
  const hooksAssignment = /^\s*hooks\s*=/;

  for (let index = 0; index < lines.length; index += 1) {
    if (anyTableHeader.test(lines[index])) break;
    const match = dottedKey.exec(lines[index]);
    if (match) {
      if (match[2] === 'true') return false;
      lines[index] = `${match[1]}true${match[3]}`;
      mkdirSync(path.dirname(configFile), { recursive: true });
      writeFileSync(configFile, lines.join('\n'));
      return true;
    }
    if (dottedAssignment.test(lines[index])) {
      throw new Error(`cannot update ${configFile}: features.hooks must be true or false`);
    }
  }

  const sectionStart = lines.findIndex((line) => tableHeader.test(line));
  if (sectionStart >= 0) {
    let sectionEnd = lines.length;
    for (let index = sectionStart + 1; index < lines.length; index += 1) {
      if (anyTableHeader.test(lines[index])) {
        sectionEnd = index;
        break;
      }
    }
    for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
      const match = hooksKey.exec(lines[index]);
      if (match) {
        if (match[2] === 'true') return false;
        lines[index] = `${match[1]}true${match[3]}`;
        writeFileSync(configFile, lines.join('\n'));
        return true;
      }
      if (hooksAssignment.test(lines[index])) {
        throw new Error(`cannot update ${configFile}: features.hooks must be true or false`);
      }
    }
    lines.splice(sectionStart + 1, 0, 'hooks = true');
    writeFileSync(configFile, lines.join('\n'));
    return true;
  }

  mkdirSync(path.dirname(configFile), { recursive: true });
  const separator = text.length === 0 ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(configFile, `${text}${separator}[features]\nhooks = true\n`);
  return true;
}

function opencodePlugin(bin) {
  return `// Managed by openscad-axi. Regenerate with \`${NPX} setup hooks\`.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const OpenscadAxiPlugin = async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    try {
      const { stdout } = await run(${JSON.stringify(bin)}, [], { cwd: process.cwd() });
      if (stdout.trim()) output.system.push(stdout.trim());
    } catch {
      // The dashboard is ambient context; never fail a session over it.
    }
  },
});
`;
}

function installOpencodePlugin(file, bin) {
  const contents = opencodePlugin(bin);
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    if (current === contents) return { state: 'unchanged', file };
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return { state: 'repaired', file };
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return { state: 'installed', file };
}

// homeDir is injectable so tests exercise scratch copies rather than the real
// user configuration.
export function installHooks({ apps, bin, homeDir = os.homedir() }) {
  const results = [];
  const notes = [];
  for (const app of apps) {
    if (app === 'claude-code') {
      const result = installSessionStartHook(path.join(homeDir, '.claude', 'settings.json'), bin);
      results.push({ app, ...result });
    } else if (app === 'codex') {
      const result = installSessionStartHook(path.join(homeDir, '.codex', 'hooks.json'), bin);
      const flipped = ensureCodexHooksFeature(path.join(homeDir, '.codex', 'config.toml'));
      if (flipped) notes.push('Enabled [features].hooks = true in ~/.codex/config.toml');
      notes.push(CODEX_HOOK_TRUST_NOTE);
      results.push({ app, ...result });
    } else {
      const result = installOpencodePlugin(
        path.join(homeDir, '.config', 'opencode', 'plugins', 'openscad-axi.js'),
        bin
      );
      results.push({ app, ...result });
    }
  }
  return { results, notes };
}

export function run({ positional, flags, json, homeDir = os.homedir(), env = process.env }) {
  const target = positional[0];
  if (!target) {
    throw new UsageError('setup requires a target', [`Run \`${NPX} setup hooks\``]);
  }
  if (target !== 'hooks') {
    throw new UsageError(`unknown setup target \`${target}\``, [
      `valid setup targets: hooks (\`${NPX} setup hooks\`)`,
    ]);
  }
  if (positional.length > 1) {
    throw new UsageError(`setup takes one target, got ${positional.length}`, [
      `Run \`${NPX} setup hooks\``,
    ]);
  }

  const appFlag = flags['--app'] || 'all';
  if (appFlag !== 'all' && !APPS.includes(appFlag)) {
    throw new UsageError(`unknown app \`${appFlag}\``, [`valid apps: ${APPS.join(', ')}, all`]);
  }
  const apps = appFlag === 'all' ? APPS : [appFlag];

  const bin = resolveHookCommand(env);
  const { results, notes } = installHooks({ apps, bin, homeDir });

  const payload = {
    setup: { hook: 'SessionStart', command: bin },
    apps: results.map((result) => ({ app: result.app, state: result.state, file: result.file })),
  };
  if (notes.length) payload.notes = notes;
  payload.help = [
    'Start a new agent session to see the models dashboard as ambient context',
    `Run \`${NPX} setup hooks\` again after reinstalling to repair the path`,
  ];
  emit(payload, { json });
  return EXIT_OK;
}
