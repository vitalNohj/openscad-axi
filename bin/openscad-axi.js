#!/usr/bin/env node
import { main } from '../src/index.js';

process.exitCode = main(process.argv.slice(2));
