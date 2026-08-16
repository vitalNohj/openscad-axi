import { UsageError } from '../lib/args.js';
import { emit, EXIT_OK } from '../lib/output.js';
import { isValidName, nextVersion } from '../lib/versions.js';
import { NPX } from '../strings.js';

export const spec = {};

export const help = {
  usage: `${NPX} next <name>`,
  summary: 'Print the next versioned .scad path for a model name',
  flags: [],
  examples: [`${NPX} next piano`, `${NPX} next phone_stand`],
};

// Always answers; there is no "already exists" failure mode.
export function run({ positional, json, cwd = process.cwd() }) {
  const name = positional[0];
  if (!name) {
    throw new UsageError('next requires a model name', [`Run \`${NPX} next <name>\``]);
  }
  if (positional.length > 1) {
    throw new UsageError(`next takes one name, got ${positional.length}`, [
      `Run \`${NPX} next <name>\``,
    ]);
  }
  // The name becomes a filename, so reject anything outside [a-z][a-z0-9_]*.
  if (!isValidName(name)) {
    throw new UsageError(`invalid model name \`${name}\``, [
      'Names must match [a-z][a-z0-9_]* , for example phone_stand',
    ]);
  }

  const result = nextVersion(cwd, name);
  emit(
    {
      next: {
        name: result.name,
        latest: result.latest || 'none',
        create: result.create,
      },
      help: [
        `Write OpenSCAD to ${result.create} then run \`${NPX} validate ${result.create}\``,
      ],
    },
    { json }
  );
  return EXIT_OK;
}
