#!/usr/bin/env node
// Compare the exact same count-only result command in raw and verbose output
// modes. Captured text is discarded after byte counting.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.env.HELIUM_BENCH_ENTRY || path.join(root, '.local/benchmarks/baseline.mjs');
const candidate = process.env.HELIUM_BENCH_CANDIDATE || path.join(root, 'bin/helium-playwright.mjs');
const outDir = path.join(root, '.local/benchmarks');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const trials = Number(process.env.HELIUM_BENCH_TRIALS || 5);
if (!Number.isInteger(trials) || trials < 3 || trials > 25) throw new Error('Trials must be 3..25');
const code = 'async page => ({ count: page.context().pages().length })';
const entries = [['baseline', baseline], ['candidate', candidate]];
const candidateFiles = [candidate, path.join(root, 'lib/output.mjs'), path.join(root, 'lib/background-tab.mjs')];
function hashCandidate() {
  const files = candidateFiles.map(file => {
    if (!existsSync(file)) throw new Error('Candidate implementation file is missing: ' + path.basename(file));
    return { file: path.relative(root, file), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
  });
  const combined = createHash('sha256');
  for (const file of files) combined.update(file.file + '\0' + file.sha256 + '\n');
  return { files, combinedSha256: combined.digest('hex') };
}
const candidateHashBefore = hashCandidate();

function one(variant, entry, verbose) {
  const args = [...(verbose ? ['--verbose'] : []), 'run-code', code];
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = stdout + '\n' + stderr;
  let correct = result.status === 0 && !result.error;
  if (!verbose) {
    try { correct = correct && JSON.parse(stdout.trim()).count > 0; }
    catch { correct = false; }
  } else correct = correct && /["']?count["']?\s*:\s*[1-9]\d*/i.test(combined);
  return {
    variant, format: verbose ? 'verbose' : 'raw',
    elapsedMs: Number(process.hrtime.bigint() - start) / 1e6,
    outputBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr),
    correctness: correct,
  };
}

// Warm each path and include those correctness results in the run gate.
const warmupSamples = [];
for (const [variant, entry] of entries) {
  warmupSamples.push(one(variant, entry, false));
  warmupSamples.push(one(variant, entry, true));
}
const samples = [];
for (let i = 0; i < trials; i++) {
  const variantOrder = i % 2 ? [...entries].reverse() : entries;
  const formatOrder = i % 2 ? [true, false] : [false, true];
  for (const verbose of formatOrder)
    for (const [variant, entry] of variantOrder) samples.push(one(variant, entry, verbose));
}
const summarize = (variant, format) => {
  const values = samples.filter(s => s.variant === variant && s.format === format);
  const distribution = key => {
    const sorted = values.map(v => v[key]).sort((a, b) => a - b);
    const percentile = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { min: sorted[0], median: percentile(0.5), p90: percentile(0.9), max: sorted.at(-1) };
  };
  return { elapsedMs: distribution('elapsedMs'), outputBytes: distribution('outputBytes'),
    allCorrect: values.every(v => v.correctness) };
};
const candidateHashAfter = hashCandidate();
if (candidateHashBefore.combinedSha256 !== candidateHashAfter.combinedSha256)
  throw new Error('Candidate implementation changed during the timing run');
const report = {
  createdAt: new Date().toISOString(),
  scenario: 'same count-only run-code command; no page content captured',
  entries: { baseline: path.basename(baseline), candidate: path.basename(candidate) },
  candidateImplementation: candidateHashBefore,
  warmupsPerPathAndFormat: 1, warmupSamples, trials,
  summaries: Object.fromEntries(entries.map(([variant]) => [variant, {
    raw: summarize(variant, 'raw'), verbose: summarize(variant, 'verbose'),
  }])),
  samples,
  note: 'Byte counts measure captured stdout and stderr only; they are not model-token counts.',
};
const reportPath = path.join(outDir, 'output-modes-' + Date.now() + '.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ reportPath: path.basename(reportPath), ...report }, null, 2));
if ([...warmupSamples, ...samples].some(sample => !sample.correctness)) {
  console.error('Benchmark failed correctness checks; see report for failing samples.');
  process.exitCode = 1;
}
