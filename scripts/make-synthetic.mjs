#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { generate } from './synthetic.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : dflt;
};

const commits = arg('commits', 100_000);
const files = arg('files', 20_000);
const seed = arg('seed', 42);
const out = process.argv.find((a) => !a.startsWith('--') && a.endsWith('.txt')) ?? 'synthetic.txt';

const started = Date.now();
const text = generate({ commits, files, seed });
writeFileSync(out, text);
console.log(
  `${out}: ${commits.toLocaleString()} commits, ${(text.length / 1e6).toFixed(1)} MB, ` +
    `generated in ${((Date.now() - started) / 1000).toFixed(1)}s (seed ${seed})`,
);
