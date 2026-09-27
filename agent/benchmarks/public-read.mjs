#!/usr/bin/env node
// Read-only benchmark against public pages already open in Helium. It never
// navigates, focuses, creates, or closes tabs and never saves page text.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEntry = path.join(root, '.local/benchmarks/baseline.mjs');
const baselineEntry = process.env.HELIUM_BENCH_ENTRY || defaultEntry;
const candidateEntry = process.env.HELIUM_BENCH_CANDIDATE || path.join(root, 'bin/helium-playwright.mjs');
const outDir = path.join(root, '.local/benchmarks');
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const pageCount = Number(process.env.HELIUM_BENCH_PUBLIC_PAGES || 5);
const warmups = Number(process.env.HELIUM_BENCH_WARMUPS || 1);
const trials = Number(process.env.HELIUM_BENCH_TRIALS || 5);
if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10 ||
    !Number.isInteger(warmups) || warmups < 0 || warmups > 5 ||
    !Number.isInteger(trials) || trials < 3 || trials > 25) {
  throw new Error('Invalid benchmark settings');
}
const isApprovedPublic = "p => ['https://www.google.com/','https://duckduckgo.com/'," +
  "'https://www.bing.com/','https://commons.wikimedia.org/','https://yandex.com/']" +
  ".some(prefix => p.url().startsWith(prefix))";

const batchCode = 'async page => { const approved = ' + isApprovedPublic + '; const pages = page.context().pages().filter(approved).slice(0, ' + pageCount + '); const rows = await Promise.all(pages.map(async p => ({ title: await p.title(), chars: (await p.locator("body").innerText({ timeout: 2000 }).catch(() => "")).length }))); return { count: rows.length, rows }; }';
const sequentialCommands = Array.from({ length: pageCount }, (_, i) => [
  'run-code',
  'async page => { const approved = ' + isApprovedPublic + '; const p = page.context().pages().filter(approved)[' + i + ']; if (!p) return { count: 0 }; return { count: 1, title: await p.title(), chars: (await p.locator("body").innerText({ timeout: 2000 }).catch(() => "")).length }; }',
]);
const modes = { sequential: sequentialCommands, batched: [['run-code', batchCode]] };
const candidateFiles = [candidateEntry, path.join(root, 'lib/output.mjs'), path.join(root, 'lib/background-tab.mjs')];
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

function run(mode, entry, variant) {
  const start = process.hrtime.bigint();
  let outputBytes = 0;
  let ok = true;
  const commands = modes[mode];
  for (const command of commands) {
    const result = spawnSync(process.execPath, [entry, ...command], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    outputBytes += Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
    if (result.error || result.status !== 0) { ok = false; continue; }
    try {
      const value = JSON.parse(stdout.trim());
      const expected = mode === 'batched' ? pageCount : 1;
      if (value.count !== expected || (mode === 'batched' && !Array.isArray(value.rows)) ||
          (mode === 'batched' && value.rows.some(row => !row.title || row.chars < 1)) ||
          (mode === 'sequential' && (!value.title || value.chars < 1))) ok = false;
    } catch { ok = false; }
  }
  return { variant, mode, elapsedMs: Number(process.hrtime.bigint() - start) / 1e6,
    cliInvocations: commands.length, outputBytes, correctness: ok };
}

// Discovery returns only a count and does not save URLs or page contents.
const probe = spawnSync(process.execPath, [baselineEntry, 'run-code',
  'async page => { const approved = ' + isApprovedPublic + '; return { count: page.context().pages().filter(approved).length }; }'],
{ cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: process.env });
if (probe.status !== 0 || !Number(JSON.parse((probe.stdout || '{}').trim()).count))
  throw new Error('No readable public pages found in the existing Helium context');

const warmupSamples = [];
for (let i = 0; i < warmups; i++) {
  const mode = i % 2 ? 'batched' : 'sequential';
  warmupSamples.push(run(mode, baselineEntry, 'baseline'));
  warmupSamples.push(run(mode, candidateEntry, 'candidate'));
}
const samples = [];
for (let i = 0; i < trials; i++) {
  const variants = i % 2 ? [['candidate', candidateEntry], ['baseline', baselineEntry]] :
    [['baseline', baselineEntry], ['candidate', candidateEntry]];
  const modeOrder = i % 2 ? ['batched', 'sequential'] : ['sequential', 'batched'];
  for (const mode of modeOrder)
    for (const [variant, entry] of variants) samples.push(run(mode, entry, variant));
}
const summarize = (variant, mode) => {
  const values = samples.filter(s => s.mode === mode && s.variant === variant);
  const sorted = values.map(s => s.elapsedMs).sort((a, b) => a - b);
  const bytes = values.map(s => s.outputBytes).sort((a, b) => a - b);
  const percentile = (array, p) => array[Math.max(0, Math.ceil(p * array.length) - 1)];
  return { elapsedMs: { min: sorted[0], median: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), max: sorted.at(-1) },
    outputBytes: { min: bytes[0], median: percentile(bytes, 0.5), p90: percentile(bytes, 0.9), max: bytes.at(-1) },
    allCorrect: values.every(s => s.correctness), cliInvocationsPerTrial: values[0].cliInvocations };
};
const candidateHashAfter = hashCandidate();
if (candidateHashBefore.combinedSha256 !== candidateHashAfter.combinedSha256)
  throw new Error('Candidate implementation changed during the timing run');
const report = {
  createdAt: new Date().toISOString(), entries: {
    baseline: path.basename(baselineEntry), candidate: path.basename(candidateEntry),
  },
  candidateImplementation: candidateHashBefore,
  scenario: 'read-only visible text from first N existing public tabs',
  publicTabsObserved: Number(JSON.parse((probe.stdout || '{}').trim()).count),
  pagesPerTrial: pageCount, warmups, trials, warmupSamples,
  summaries: {
    baseline: { sequential: summarize('baseline', 'sequential'), batched: summarize('baseline', 'batched') },
    candidate: { sequential: summarize('candidate', 'sequential'), batched: summarize('candidate', 'batched') },
  },
  samples,
  note: 'Output bytes are a transport proxy, not model-token measurements. Raw page text and URLs were discarded.',
};
const reportPath = path.join(outDir, 'public-read-' + Date.now() + '.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ reportPath: path.basename(reportPath), ...report }, null, 2));
if ([...warmupSamples, ...samples].some(sample => !sample.correctness)) {
  console.error('Benchmark failed correctness checks; see report for failing samples.');
  process.exitCode = 1;
}
