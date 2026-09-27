// Recreate the pre-optimization launcher without changing the working tree.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const revision = '12f4478';
const source = execFileSync('git', ['show', `${revision}:agent/bin/helium-playwright.mjs`], { cwd: root, encoding: 'utf8' });
const marker = "const root = fileURLToPath(new URL('../', import.meta.url));";
if (source.split(marker).length !== 2) throw new Error('Baseline root marker does not match');
const out = path.join(root, '.local/benchmarks');
mkdirSync(out, { recursive: true, mode: 0o700 });
writeFileSync(path.join(out, 'baseline.mjs'), source.replace(marker, `const root = ${JSON.stringify(root)};`), { mode: 0o700 });
console.log(`Frozen launcher baseline from ${revision}.`);
