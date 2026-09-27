#!/usr/bin/env node
// Local workflow benchmark: ordinary one-workflow-per-CLI-call against one
// batched run-code call. All pages and downloaded content are loopback fixtures.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixture.mjs';

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.local/benchmarks');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const reportPath = path.join(outDir, `workflows-${Date.now()}.json`);
const baselineEntry = process.env.HELIUM_BENCH_ENTRY || path.join(root, '.local/benchmarks/baseline.mjs');
const candidateEntry = process.env.HELIUM_BENCH_CANDIDATE || path.join(root, 'bin/helium-playwright.mjs');
const smoke = process.env.HELIUM_BENCH_SMOKE === '1';
const eventExperiment = process.env.HELIUM_BENCH_EXPERIMENT === 'event-wait';
const modes = eventExperiment ? ['parallel','parallel-event'] : ['sequential','batched','parallel'];
const warmups = Number(process.env.HELIUM_BENCH_WARMUPS || (smoke ? 0 : 1));
const trials = Number(process.env.HELIUM_BENCH_TRIALS || (smoke ? 1 : 5));
if (!Number.isInteger(warmups) || warmups < 0 || warmups > 5 || !Number.isInteger(trials) || trials < (smoke ? 1 : 3) || trials > 25)
  throw new Error('Invalid benchmark settings');

function invoke(entry, code) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [entry, 'run-code', code], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, bytes, error: 'CLI timed out after 20s' }); }, 20_000);
    function finish(value) { if (settled) return; settled = true; clearTimeout(timer); resolve(value); }
    child.stdout.on('data', b => { stdout += b; bytes += b.length; });
    child.stderr.on('data', b => { stderr += b; bytes += b.length; });
    child.on('error', error => finish({ ok: false, error: error.message, bytes }));
    child.on('close', status => {
      try { finish({ ok: status === 0, value: JSON.parse(stdout.trim()), bytes, status, error: status === 0 ? undefined : `cli status ${status}`, detail: status === 0 ? undefined : (stderr || stdout).trim().slice(0, 500) }); }
      catch { finish({ ok: false, bytes, status, error: `invalid CLI result (${status})`, detail: (stderr || stdout).trim().slice(0, 500) }); }
    });
  });
}

const workflowSources = {
  form: `async p=>{await p.getByLabel('Name').fill('Ada Lovelace');await p.getByLabel('Email').fill('ada@example.test');await p.getByLabel('Plan').selectOption({label:'Pro'});await p.getByLabel('Updates').check();await p.getByRole('button',{name:'Save profile'}).click();await p.locator('#result').waitFor({state:'visible'});const got=JSON.parse(await p.locator('#result').innerText());return got.name==='Ada Lovelace'&&got.email==='ada@example.test'&&got.plan==='Pro'&&got.updates;}`,
  catalog: `async p=>{await p.locator('#category').selectOption('books');await p.locator('#next').click();await p.locator('#page').filter({hasText:/^2$/}).waitFor({state:'visible',timeout:5000});const visible=await p.locator('#items li:not([hidden])').allTextContents();return visible.join(',')==='Item 16,Item 19,Item 22,Item 25,Item 28';}`,
  delayed: `async p=>{await p.locator('#start').click();await p.getByText('Ready',{exact:true}).waitFor({state:'visible',timeout:5000});return await p.locator('#status').innerText()==='Ready';}`,
};
const expectedDocument = 'helium-local-document-fixture-v1\nExpected content for download verification.\n';

function taskCode(origin, name, downloadPath, eventWait = false) {
  const url = `${origin}/${name}` + (name === 'download' ? `?name=${encodeURIComponent(path.basename(downloadPath))}` : '');
  const urlLiteral = JSON.stringify(url);
  // The official extension does not emit Playwright's download event here.
  // Exercise the real link click; the Node harness verifies completed file bytes.
  if (name === 'download') return `async page=>{try{const p=page.context().pages().find(x=>x.url()===${urlLiteral});if(!p)throw Error('fixture tab missing');await p.getByRole('link',{name:'Download document'}).click({timeout:5000});return {ok:true}}catch(e){return {ok:false,error:String(e.message||e)}}}`;
  const source = name === 'delayed' && eventWait ? workflowSources[name].replace("await p.locator('#start').click();", "const response=p.waitForResponse(r=>r.url().endsWith('/status')&&r.status()===200,{timeout:5000});response.catch(()=>{});await p.locator('#start').click();await response;") : workflowSources[name];
  return `async page=>{try{const p=page.context().pages().find(x=>x.url()===${urlLiteral});if(!p)throw Error('fixture tab missing');p.setDefaultTimeout(5000);p.setDefaultNavigationTimeout(5000);return {ok:!!(await (${source})(p))}}catch(e){return {ok:false,error:String(e.message||e)}}}`;
}

async function setup(entry, origin, names, downloadPath) {
  const urls = names.map(name => `${origin}/${name}` + (name === 'download' ? `?name=${encodeURIComponent(path.basename(downloadPath))}` : ''));
  const code = `async page=>{const urls=${JSON.stringify(urls)};const current=await page.evaluate(async()=>chrome.tabs.getCurrent());if(!current)throw Error('no Helium helper tab');const selectedBefore=(await page.evaluate(async()=>chrome.tabs.query({active:true,currentWindow:true})))[0]?.id;const ids=[];for(const url of urls){const pending=page.context().waitForEvent('page',{timeout:5000});const id=await page.evaluate(async url=>{const c=await chrome.tabs.getCurrent();const t=await chrome.tabs.create({windowId:c.windowId,active:false,url:'about:blank'});await chrome.tabs.group({tabIds:[t.id],groupId:c.groupId});return t.id},url);ids.push(id);const p=await pending;await p.goto(url,{timeout:5000,waitUntil:'domcontentloaded'});p.setDefaultTimeout(5000);p.setDefaultNavigationTimeout(5000)}const selectedAfter=(await page.evaluate(async()=>chrome.tabs.query({active:true,currentWindow:true})))[0]?.id;return {ids,selectedBefore,selectedAfter};}`;
  const result = await invoke(entry, code);
  if (!result.ok || !Array.isArray(result.value?.ids)) throw Error(`fixture setup failed: ${result.error || 'missing IDs'} ${result.detail || ''}`.trim());
  return { ids: result.value.ids, selectedBefore: result.value.selectedBefore, selectedAfterSetup: result.value.selectedAfter, setupKeptSelection: result.value.selectedBefore === result.value.selectedAfter };
}

async function teardown(entry, ids) {
  const code = `async page=>{const ids=${JSON.stringify(ids)};await page.evaluate(async ids=>chrome.tabs.remove(ids),ids);return true;}`;
  return invoke(entry, code);
}

async function runCase(entry, variant, mode, origin, trial) {
  const names = ['form', 'catalog', 'delayed', 'download'];
  const dlPath = path.join(process.env.HELIUM_BENCH_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads'), server.downloadName.replace('.txt', `-${variant}-${mode}-${trial}.txt`));
  let before;
  try { before = await setup(entry, origin, names, dlPath); }
  catch (error) { return { variant, mode, trial, elapsedMs: 0, cliInvocations: 0, outputBytes: 0, correctness: false, setupError: String(error.message || error), perWorkflow: Object.fromEntries(names.map(n => [n, { correct: false, error: 'fixture setup failed' }])) }; }

  let cleanupDone = false;
  try {
    const commands = names.map(name => taskCode(origin, name, dlPath, mode === 'parallel-event'));
    const start = process.hrtime.bigint();
    let bytes = 0, correct = true;
    const values = [];
    if (mode === 'sequential') {
      for (let i = 0; i < commands.length; i++) {
        const res = await invoke(entry, commands[i]); bytes += res.bytes;
        values.push(res.ok ? res.value : {ok:false,error:res.error}); if (!res.ok || !res.value?.ok) correct = false;
      }
    } else {
      // Compose the same workflow callbacks into a single run-code operation.
      const expr = mode.startsWith('parallel') ? `await Promise.all([${commands.map(src => `(${src})(page)`).join(',')}])` : `[${commands.map(src => `await (${src})(page)`).join(',')}]`;
      const res = await invoke(entry, `async page=>${expr}`); bytes += res.bytes; values.push(...(Array.isArray(res.value) ? res.value : names.map(()=>({ok:false,error:res.error || 'missing results'}))));
      if (!res.ok || values.length !== names.length || values.some(v => !v?.ok)) correct = false;
    }
    const downloadDeadline = Date.now() + 5000;
    let downloaded = false;
    while (Date.now() < downloadDeadline) {
      downloaded = existsSync(dlPath) && readFileSync(dlPath, 'utf8') === expectedDocument;
      if (downloaded) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (!downloaded) correct = false;
    const selectedResult = await invoke(entry, `async page=>({selected:(await page.evaluate(async()=>chrome.tabs.query({active:true,currentWindow:true})))[0]?.id})`);
    const selectedUnchanged = before.setupKeptSelection && selectedResult.ok && selectedResult.value.selected === before.selectedBefore;
    if (!selectedUnchanged) correct = false;
    const perWorkflow = Object.fromEntries(names.map((name, i) => [name, { correct: !!values[i]?.ok, error: values[i]?.error || null, downloadedContentCorrect: name === 'download' ? downloaded : undefined }]));
    const cleanup = await teardown(entry, before.ids);
    cleanupDone = true;
    const cleanupOk = cleanup.ok && cleanup.value === true;
    if (!cleanupOk) correct = false;
    return { variant, mode, trial, elapsedMs, cliInvocations: mode === 'sequential' ? commands.length : 1, outputBytes: bytes, correctness: correct, perWorkflow, selectedTab: { before: before.selectedBefore, afterSetup: before.selectedAfterSetup, afterWorkflow: selectedResult.value?.selected, unchanged: selectedUnchanged }, downloadedContentCorrect: downloaded, cleanupOk, cleanupError: cleanupOk ? null : cleanup.error || 'cleanup failed' };
  } finally {
    // If the normal cleanup above did not run (for example an unexpected
    // local filesystem error), still remove only tabs created by this case.
    if (before.ids?.length && !cleanupDone) await teardown(entry, before.ids).catch(() => {});
    if (existsSync(dlPath)) unlinkSync(dlPath);
  }
}

const server = await startFixtureServer();
try {
  const probe = await invoke(candidateEntry, 'async page=>({ok:true})');
  if (!probe.ok || !probe.value?.ok) throw Error('Candidate CLI is not connected to Helium');
  const samples = [];
  const warmupResults = [];
  for (let i = 0; i < warmups; i++) {
    const a = await runCase(eventExperiment ? candidateEntry : baselineEntry, eventExperiment ? 'candidate' : 'baseline', eventExperiment ? 'parallel' : (i % 2 ? 'batched' : 'sequential'), server.origin, `warm-${i}`);
    const b = await runCase(candidateEntry, 'candidate', eventExperiment ? 'parallel-event' : (i % 2 ? 'sequential' : 'batched'), server.origin, `warm-${i}`);
    warmupResults.push(a, b);
    writeFileSync(reportPath, JSON.stringify({warmupResults, samples}, null, 2), {mode:0o600});
    if (!a.correctness || !b.correctness) throw Error('Workflow warmup failed; inspect ' + reportPath);
    console.error(`workflow warmup ${i + 1}/${warmups}: baseline=${a.correctness ? 'ok' : 'failed'} candidate=${b.correctness ? 'ok' : 'failed'}`);
  }
  trialsLoop: for (let i = 0; i < trials; i++) {
    const order = (smoke || eventExperiment) ? [['candidate', candidateEntry]] : (i % 2 ? [['candidate', candidateEntry], ['baseline', baselineEntry]] : [['baseline', baselineEntry], ['candidate', candidateEntry]]);
    for (const [variant, entry] of order) for (const mode of (i % 2 ? [...modes].reverse() : modes)) {
      const sample = await runCase(entry, variant, mode, server.origin, i);
      samples.push(sample);
      console.error(`workflow trial ${i + 1}/${trials} ${variant}/${mode}: ${sample.correctness ? 'ok' : JSON.stringify({ setupError: sample.setupError, perWorkflow: sample.perWorkflow, selectedTab: sample.selectedTab, downloadedContentCorrect: sample.downloadedContentCorrect, cleanupError: sample.cleanupError })}`);
      writeFileSync(reportPath, JSON.stringify({ createdAt: new Date().toISOString(), scenario: 'local loopback workflow benchmark', warmups, warmupResults, trials, samples }, null, 2), { mode: 0o600 });
      if (!sample.correctness) break trialsLoop;
    }
  }
  const summarize = (variant, mode) => {
    const rows = samples.filter(x => x.variant === variant && x.mode === mode);
    const values = rows.map(x => x.elapsedMs).sort((a,b)=>a-b);
    return rows.length ? { minMs: values[0], maxMs: values.at(-1), p90Ms: values[Math.ceil(values.length * 0.9)-1], medianMs: (values[Math.floor((values.length-1)/2)] + values[Math.floor(values.length/2)])/2, allCorrect: rows.every(x => x.correctness), cliInvocationsPerTrial: rows[0].cliInvocations } : null;
  };
  const report = { createdAt: new Date().toISOString(), node: process.version, nativeSettleMs: JSON.parse(readFileSync(path.join(root,'.local/cli.config.json'),'utf8')).timeouts?.settle ?? 500, sourceHashes: Object.fromEntries(['bin/helium-playwright.mjs','lib/output.mjs','lib/background-tab.mjs','benchmarks/workflows.mjs','benchmarks/fixture.mjs'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex')])), scenario: 'local loopback workflows: form submit, catalog filter and pagination, delayed fetch and UI, browser download with filesystem verification', warmups, warmupResults, trials,
    eventExperiment, summaries: Object.fromEntries(['baseline','candidate'].map(variant=>[variant,Object.fromEntries(modes.map(mode=>[mode,summarize(variant,mode)]))])), samples,
    downloadMethod: 'Native Playwright link click, then bounded filesystem completion and exact-content check; Playwright download events are unsupported by this extension connection.',
    note: 'Fixture setup and teardown are excluded from workflow timing. Raw page content and browser URLs are not saved; output bytes are a transport proxy, not model-token measurements.' };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath: path.basename(reportPath), ...report }, null, 2));
  if (samples.some(sample => !sample.correctness) || warmupResults.some(sample => !sample.correctness)) process.exitCode = 1;
} finally { await server.close(); }
