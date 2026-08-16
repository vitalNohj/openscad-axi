#!/usr/bin/env node
// Generates skill/SKILL.md from the same strings the CLI's help and home view
// use, so the skill cannot drift from what the CLI actually prints.
// `--check` diffs against the committed file and exits nonzero on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMAND_SUMMARY,
  INSTALL_COMMAND,
  NPX,
  PRINTABILITY,
  SKILL_DESCRIPTION,
  TIPS,
  WORKFLOW,
} from '../src/strings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'skill', 'SKILL.md');

function numbered(steps) {
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

function bullets(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

export function renderSkill() {
  return `---
name: openscad-axi
description: >-
${SKILL_DESCRIPTION.map((line) => `  ${line}`).join('\n')}
user-invocable: false
---

# openscad-axi

Agent-ergonomic wrapper around OpenSCAD for the write, preview, export loop.

You do not need openscad-axi installed globally - invoke it with \`${NPX} <command>\`.
If openscad-axi output shows a follow-up command starting with \`openscad-axi\`, run it as
\`${NPX} ...\` instead.

Requires OpenSCAD installed (\`${INSTALL_COMMAND}\` preferred). If a command
reports the binary is missing, run \`${NPX} doctor\` and relay its advice.

## Workflow

${numbered(WORKFLOW)}

## Commands

\`\`\`
commands[${COMMAND_SUMMARY.length}]:
  ${COMMAND_SUMMARY.join(', ')}
\`\`\`

Run \`${NPX} <command> --help\` for per-command flags.

## Printability (design-time rules)

${bullets(PRINTABILITY)}

## Tips

${bullets(TIPS)}
`;
}

// Progress and diagnostics go to stderr; this is a build tool, and stdout stays
// free for piping the rendered skill if a caller wants it.
function report(message) {
  process.stderr.write(`${message}\n`);
}

function main() {
  const contents = renderSkill();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      report('skill/SKILL.md is missing. Run `npm run gen-skill`.');
      process.exitCode = 1;
      return;
    }
    if (current !== contents) {
      report('skill/SKILL.md is out of date. Run `npm run gen-skill` and commit the result.');
      process.exitCode = 1;
      return;
    }
    report('skill/SKILL.md is up to date.');
    return;
  }
  writeFileSync(target, contents);
  report(`wrote ${path.relative(process.cwd(), target)}`);
}

// Guarded so tests can import renderSkill without writing to disk.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
