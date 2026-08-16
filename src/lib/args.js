// Hand-rolled argument parsing so unknown-flag rejection is exact (AXI 6).
// Every command declares its own flag spec; anything not in it is rejected by
// name with the command's valid flags inlined.

export const GLOBAL_FLAGS = ['--json', '--help', '-v', '-V', '--version'];

export class UsageError extends Error {
  constructor(message, help = []) {
    super(message);
    this.name = 'UsageError';
    this.help = help;
  }
}

// Flags that were renamed or removed get a targeted hint instead of the
// generic valid-flag list.
const RENAMED = {
  '--out-dir': '--out',
  '--output-dir': '--out',
  '--image-size': '--size',
  '--colourscheme': '--colorscheme',
  '--stl': '--output',
  '--ascii': '--format asciistl',
  '--render': '--full-render',
  '--angles': '--angle',
};

function describeFlags(spec) {
  const names = Object.keys(spec).sort();
  return names.length ? names.join(', ') : '(none)';
}

/**
 * spec maps flag name -> { type: 'boolean' | 'value' | 'repeat', alias?: string }
 * Returns { flags, positional, json, help, version }.
 */
export function parseArgs(argv, spec, commandLabel) {
  const aliasMap = new Map();
  for (const [name, def] of Object.entries(spec)) {
    if (def.alias) aliasMap.set(def.alias, name);
  }
  const flags = {};
  const positional = [];
  const result = { flags, positional, json: false, help: false, version: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      positional.push(token);
      continue;
    }
    let name = token;
    let inlineValue = null;
    const eq = token.indexOf('=');
    if (eq > 1) {
      name = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }
    if (aliasMap.has(name)) name = aliasMap.get(name);

    if (name === '--json') {
      result.json = true;
      continue;
    }
    if (name === '--help' || name === '-h') {
      result.help = true;
      continue;
    }
    if (name === '-v' || name === '-V' || name === '--version') {
      result.version = true;
      continue;
    }
    const def = spec[name];
    if (!def) {
      const replacement = RENAMED[name];
      if (replacement) {
        throw new UsageError(
          `unknown flag ${name} for \`${commandLabel}\``,
          [`${name} was renamed; use ${replacement} instead`]
        );
      }
      throw new UsageError(`unknown flag ${name} for \`${commandLabel}\``, [
        `valid flags for \`${commandLabel}\`: ${describeFlags(spec)} (--json, --help, -v/--version always allowed)`,
      ]);
    }
    if (def.type === 'boolean') {
      if (inlineValue !== null) {
        throw new UsageError(`flag ${name} does not take a value`, [
          `Use \`${name}\` on its own for \`${commandLabel}\``,
        ]);
      }
      flags[name] = true;
      continue;
    }
    let value = inlineValue;
    if (value === null) {
      value = argv[i + 1];
      if (value === undefined || (value.startsWith('-') && value.length > 1)) {
        throw new UsageError(`flag ${name} requires a value`, [
          `Example: \`${commandLabel} ${name} <value>\``,
        ]);
      }
      i += 1;
    }
    if (def.type === 'repeat') {
      if (!flags[name]) flags[name] = [];
      flags[name].push(value);
      continue;
    }
    flags[name] = value;
  }
  return result;
}

// -D var=value, repeatable; each becomes a separate OpenSCAD -D argument.
export function parseDefines(values, commandLabel) {
  const defines = [];
  for (const raw of values || []) {
    if (!/^[^=\s]+=.*/.test(raw)) {
      throw new UsageError(`invalid -D value \`${raw}\``, [
        `Use \`${commandLabel} -D <var>=<value>\`, for example -D width=80`,
      ]);
    }
    defines.push(raw);
  }
  return defines;
}
