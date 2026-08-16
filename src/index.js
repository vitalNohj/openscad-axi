// Command registry and global flag handling.
import { createRequire } from 'node:module';
import { parseArgs, UsageError } from './lib/args.js';
import { emit, emitError, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from './lib/output.js';
import { OpenscadMissingError, SEARCHED_DESCRIPTION } from './openscad.js';
import { DESCRIPTION, DOCTOR_HINT, INSTALL_HINT, NPX, TIPS } from './strings.js';

import * as home from './commands/home.js';
import * as next from './commands/next.js';
import * as validate from './commands/validate.js';
import * as preview from './commands/preview.js';
import * as params from './commands/params.js';
import * as exportCommand from './commands/export.js';
import * as doctor from './commands/doctor.js';
import * as setup from './commands/setup.js';

const require = createRequire(import.meta.url);

export const COMMANDS = {
  next,
  validate,
  preview,
  params,
  export: exportCommand,
  doctor,
  setup,
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

function version() {
  return require('../package.json').version;
}

function emitCommandHelp(name, module, json) {
  const { help } = module;
  const payload = { usage: help.usage, description: help.summary };
  if (help.flags && help.flags.length) payload.flags = help.flags;
  if (help.notes && help.notes.length) payload.notes = help.notes;
  payload.examples = help.examples;
  emit(payload, { json });
  return EXIT_OK;
}

function emitGlobalHelp(json) {
  emit(
    {
      usage: `${NPX} [command] [args] [flags]`,
      description: DESCRIPTION,
      commands: ['(none)=models dashboard', ...COMMAND_NAMES],
      flags: ['--json  print a JSON envelope instead of TOON', '--help', '-v/--version'],
      env: ['OPENSCAD_AXI_BIN  path to the OpenSCAD executable to use'],
      tips: TIPS,
      help: [`Run \`${NPX} <command> --help\` for per-command flags`],
    },
    { json }
  );
  return EXIT_OK;
}

function extractGlobals(argv) {
  const remaining = [];
  let json = false;
  let literal = false;
  for (const token of argv) {
    if (!literal && token === '--') {
      literal = true;
      remaining.push(token);
    } else if (!literal && token === '--json') {
      json = true;
    } else {
      remaining.push(token);
    }
  }
  return { argv: remaining, json };
}

export function main(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const globals = extractGlobals(argv);
  const [first, ...rest] = globals.argv;
  const wantsJson = globals.json;

  // Globals accepted before any command.
  if (first === '-v' || first === '-V' || first === '--version') {
    emit({ version: version() }, { json: wantsJson });
    return EXIT_OK;
  }
  if (first === '--help' || first === '-h') return emitGlobalHelp(wantsJson);

  if (first === undefined || first.startsWith('-')) {
    // No command: home view, after validating that any flags given are global.
    try {
      const parsed = parseArgs(globals.argv, home.spec, 'openscad-axi');
      parsed.json = parsed.json || wantsJson;
      if (parsed.version) {
        emit({ version: version() }, { json: parsed.json });
        return EXIT_OK;
      }
      if (parsed.help) return emitGlobalHelp(parsed.json);
      return runCommand(home, { ...parsed, cwd, env });
    } catch (error) {
      return handleError(error, wantsJson);
    }
  }

  const module = COMMANDS[first];
  if (!module) {
    emitError(`unknown command \`${first}\``, [`valid commands: ${COMMAND_NAMES.join(', ')}`], {
      json: wantsJson,
    });
    return EXIT_USAGE;
  }

  try {
    const parsed = parseArgs(rest, module.spec, first);
    parsed.json = parsed.json || wantsJson;
    if (parsed.version) {
      emit({ version: version() }, { json: parsed.json });
      return EXIT_OK;
    }
    if (parsed.help) return emitCommandHelp(first, module, parsed.json);
    return runCommand(module, { ...parsed, cwd, env });
  } catch (error) {
    return handleError(error, wantsJson);
  }
}

function runCommand(module, context) {
  try {
    return module.run(context);
  } catch (error) {
    return handleError(error, context.json);
  }
}

function handleError(error, json) {
  if (error instanceof UsageError) {
    emitError(error.message, error.help, { json });
    return EXIT_USAGE;
  }
  if (error instanceof OpenscadMissingError) {
    emitError('OpenSCAD binary not found', [DOCTOR_HINT, INSTALL_HINT], {
      json,
      detail: error.detail || SEARCHED_DESCRIPTION,
    });
    return EXIT_ERROR;
  }
  emitError(error.message || String(error), [DOCTOR_HINT], { json });
  return EXIT_ERROR;
}
