import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onPath } from '../openscad.js';
import { UsageError } from '../lib/args.js';
import { emit, EXIT_OK } from '../lib/output.js';
import { NPX } from '../strings.js';

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
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hookCommandText(bin) {
  // `|| true` keeps a session from failing when the dashboard cannot run.
  return `${bin} || true`;
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
  if (/^\s*hooks\s*=\s*true\s*$/m.test(text)) return false;
  if (/^\s*hooks\s*=\s*false\s*$/m.test(text)) {
    writeFileSync(configFile, text.replace(/^\s*hooks\s*=\s*false\s*$/m, 'hooks = true'));
    return true;
  }
  if (/^\s*\[features\]\s*$/m.test(text)) {
    writeFileSync(configFile, text.replace(/^\s*\[features\]\s*$/m, '[features]\nhooks = true'));
    return true;
  }
  mkdirSync(path.dirname(configFile), { recursive: true });
  const prefix = text.length && !text.endsWith('\n') ? '\n' : '';
  writeFileSync(configFile, `${text}${prefix}\n[features]\nhooks = true\n`);
  return true;
}

function opencodePlugin(bin) {
  return `// Managed by openscad-axi. Regenerate with \`${NPX} setup hooks\`.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const OpenscadAxiPlugin = async () => ({
  event: async ({ event }) => {
    if (event.type !== "session.created") return;
    try {
      const { stdout } = await run(${JSON.stringify(bin)}, [], { cwd: process.cwd() });
      if (stdout.trim()) console.log(stdout.trim());
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
