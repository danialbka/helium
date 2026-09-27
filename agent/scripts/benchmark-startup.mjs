// Offline A/B experiment: does Node's compilation cache help the native client?
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, '.local/benchmarks');
mkdirSync(out, { recursive: true, mode: 0o700 });
const samples = [];
function sample(cache) {
  const env = { ...process.env };
  delete env.NODE_COMPILE_CACHE;
  if (cache) env.NODE_COMPILE_CACHE = path.join(out, 'node-compile-cache');
  const start = performance.now();
  const result = spawnSync(process.execPath, [path.join(root, 'bin/helium-playwright.mjs'), '--version'], { env, encoding: 'utf8', timeout: 10000 });
  return { cache, ms: performance.now() - start, ok: result.status === 0 && result.stdout.trim() === '0.1.21' };
}
for (let i = 0; i < 3; i++) { sample(false); sample(true); }
for (let i = 0; i < 30; i++) for (const cache of (i % 2 ? [true, false] : [false, true])) samples.push(sample(cache));
const summary = [false, true].map(cache => {
  const rows = samples.filter(s => s.cache === cache);
  const times = rows.map(r => r.ms).sort((a,b) => a-b);
  return { cache, medianMs: (times[14] + times[15]) / 2, minMs: times[0], maxMs: times.at(-1), allCorrect: rows.every(r => r.ok) };
});
const report = { date: new Date().toISOString(), node: process.version, summary, samples };
writeFileSync(path.join(out, 'startup.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(summary));
if (samples.some(s => !s.ok)) process.exitCode = 1;
