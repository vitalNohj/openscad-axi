#!/usr/bin/env node
// Generates README.md's command table from the command help definitions.
// `--check` diffs against the committed file and exits nonzero on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as home from '../src/commands/home.js';
import { COMMANDS } from '../src/index.js';
import { NPX } from '../src/strings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'README.md');
const startMarker = '<!-- command-reference:start -->';
const endMarker = '<!-- command-reference:end -->';

function briefUsage(name, module) {
  if (name === '(none)') return name;
  return module.help.usage.slice(`${NPX} `.length).split(' [', 1)[0];
}

function renderTable() {
  const commands = [['(none)', home], ...Object.entries(COMMANDS)];
  const rows = commands.map(([name, module]) => [
    `\`${briefUsage(name, module)}\``,
    module.help.summary,
  ]);
  const commandWidth = Math.max('Command'.length, ...rows.map(([command]) => command.length));
  const summaryWidth = Math.max('What it does'.length, ...rows.map(([, summary]) => summary.length));
  const row = (command, summary) =>
    `| ${command.padEnd(commandWidth)} | ${summary.padEnd(summaryWidth)} |`;

  return [
    startMarker,
    row('Command', 'What it does'),
    row('-'.repeat(commandWidth), '-'.repeat(summaryWidth)),
    ...rows.map(([command, summary]) => row(command, summary)),
    endMarker,
  ].join('\n');
}

function renderReadme(current) {
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (!pattern.test(current)) {
    throw new Error(`README.md is missing ${startMarker} and ${endMarker}`);
  }
  return current.replace(pattern, renderTable());
}

function report(message) {
  process.stderr.write(`${message}\n`);
}

function main() {
  const current = readFileSync(target, 'utf8');
  const contents = renderReadme(current);
  if (process.argv.includes('--check')) {
    if (current !== contents) {
      report('README.md command table is out of date. Run `npm run gen-readme` and commit it.');
      process.exitCode = 1;
      return;
    }
    report('README.md command table is up to date.');
    return;
  }
  writeFileSync(target, contents);
  report(`wrote ${path.relative(process.cwd(), target)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
