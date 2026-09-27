import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agent = fileURLToPath(new URL('../', import.meta.url));
const launcher = path.join(agent, 'bin/helium-playwright.mjs');
const node = process.execPath;

function cli(args, extraEnv = {}, cwd = agent) {
  return spawnSync(node, [launcher, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...extraEnv },
  });
}

test('official help, version, and invalid command survive in-process CLI exits', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /playwright-cli/);

  const version = cli(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);

  const invalid = cli(['not-a-command']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown command/);

  const invalidFlag = cli(['tab-list', '--not-a-real-flag']);
  assert.equal(invalidFlag.status, 1);
  assert.match(invalidFlag.stderr, /Unknown option/);

  const daemonDir = mkdtempSync(path.join(os.tmpdir(), 'helium-cli-cwd-test-'));
  try {
    const json = cli(['--json', 'tab-list'], { PWTEST_DAEMON_SESSION_DIR: daemonDir }, os.tmpdir());
    assert.equal(json.status, 1);
    assert.equal(JSON.parse(json.stdout).isError, true);

    const verbose = cli(['--verbose', 'tab-list'], { PWTEST_DAEMON_SESSION_DIR: daemonDir }, os.tmpdir());
    assert.equal(verbose.status, 1);
    assert.match(verbose.stdout, /browser.*not open/i);
    assert.equal(verbose.stderr, '');
  } finally {
    rmSync(daemonDir, { recursive: true, force: true });
  }
});

test('all explicit session spellings reach the requested missing session without attaching', () => {
  const daemonDir = mkdtempSync(path.join(os.tmpdir(), 'helium-cli-test-'));
  try {
    const cases = [
      [['-s', 'short-space'], 'short-space'],
      [['-s=short-equals'], 'short-equals'],
      [['--session', 'long-space'], 'long-space'],
      [['--session=long-equals'], 'long-equals'],
    ];
    for (const [flags, name] of cases) {
      const result = cli([...flags, 'tab-list'], {
        PWTEST_DAEMON_SESSION_DIR: daemonDir,
      });
      assert.notEqual(result.error?.code, 'ETIMEDOUT');
      assert.equal(result.status, 1, `${flags.join(' ')}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout + result.stderr, new RegExp(name));
      assert.doesNotMatch(result.stdout + result.stderr, /created, attached|connect page/);
    }
  } finally {
    rmSync(daemonDir, { recursive: true, force: true });
  }
});

test('output guard redacts secrets split across writes and preserves split UTF-8 on process.exit', () => {
  const token = 'SYNTHETIC_SECRET+TOKEN/123456789=';
  const code = `
    import { protectOutput } from ${JSON.stringify(path.join(agent, 'lib/output.mjs'))};
    protectOutput(${JSON.stringify(token)});
    const text = 'café URL?token=${token}';
    const bytes = Buffer.from(text);
    const utf8Split = bytes.indexOf(Buffer.from('é')) + 1;
    const tokenStart = bytes.indexOf(Buffer.from(${JSON.stringify(token)}));
    const tokenSplit = tokenStart + 12;
    process.stdout.write(bytes.subarray(0, utf8Split));
    process.stdout.write(bytes.subarray(utf8Split, tokenSplit));
    process.stdout.write(bytes.subarray(tokenSplit));
    process.stderr.write('ERROR ${token}');
    process.exit(0);
  `;
  const result = spawnSync(node, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'café URL?token=[redacted]');
  assert.equal(result.stderr, 'ERROR [redacted]');
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
});

test('output guard preserves output larger than a pipe buffer and redacts encoded token form', () => {
  const token = 'SYNTHETIC_SECRET+TOKEN/123456789=';
  const payload = 'x'.repeat(80_000);
  const code = `
    import { protectOutput } from ${JSON.stringify(path.join(agent, 'lib/output.mjs'))};
    protectOutput(${JSON.stringify(token)});
    process.stdout.write(${JSON.stringify(payload)} + encodeURIComponent(${JSON.stringify(token)}));
  `;
  const result = spawnSync(node, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${payload}[redacted]`);
});

test('output cap fails clearly and keeps already buffered secrets redacted', () => {
  const modulePath = path.join(agent, 'lib/output.mjs');
  const code = `import {protectOutput} from ${JSON.stringify(modulePath)};
    protectOutput('synthetic-secret', 128);
    process.stdout.write('synthetic-secret');
    process.stdout.write('x'.repeat(129));`;
  const result = spawnSync(node, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[redacted\]/);
  assert.match(result.stdout, /output exceeded/);
  assert.doesNotMatch(result.stdout, /synthetic-secret/);
});

test('connect times out on an unresponsive isolated daemon without attaching', async () => {
  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'helium-stall-'));
  const socketPath = path.join(dir, 'daemon.sock');
  const sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const registryPath = path.join(agent, 'node_modules/playwright-core/lib/tools/cli-client/registry.js');
    const infoResult = spawnSync(node, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(registryPath)}).createClientInfo()))`], {
      cwd: agent, env: { ...process.env, PWTEST_DAEMON_SESSION_DIR: dir }, encoding: 'utf8',
    });
    assert.equal(infoResult.status, 0, infoResult.stderr);
    const info = JSON.parse(infoResult.stdout);
    mkdirSync(info.daemonProfilesDir, { recursive: true });
    writeFileSync(path.join(info.daemonProfilesDir, 'helium.session'), JSON.stringify({ name: 'helium', version: info.version, socketPath }));
    const result = await new Promise(resolve => {
      const child = spawn(node, [launcher, 'connect'], { cwd: agent, env: { ...process.env, PWTEST_DAEMON_SESSION_DIR: dir, HELIUM_PLAYWRIGHT_SESSION: 'helium' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 14000);
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.once('close', (status, signal) => { clearTimeout(watchdog); resolve({ status, signal, stdout, stderr }); });
    });
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.match(result.stderr, /timed out after 10 seconds/);
    assert.doesNotMatch(result.stdout + result.stderr, /created, attached|connect page/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('background tab code preserves literal URLs and attaches before navigation', async () => {
  const { backgroundTabCode } = await import('../lib/background-tab.mjs');
  const { runInNewContext } = await import('node:vm');
  assert.throws(() => backgroundTabCode('about:blank'), /HTTP\(S\)/);
  assert.throws(() => backgroundTabCode('data:text/html,test'), /HTTP\(S\)/);
  const url = 'https://example.test/"; throw Error("injected"); //?x=`${danger}`';
  const order = [];
  let navigated;
  const target = { goto: async value => { order.push('navigate'); navigated = value; }, url: () => navigated, title: async () => 'Fixture' };
  const helper = {
    url: () => 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html',
    evaluate: async (_fn, arg) => {
      if (typeof arg === 'string') { assert.match(arg, /^about:blank#helium-/); order.push('create'); return { id: 20, before: 1, windowId: 2 }; }
      return 1;
    },
  };
  const context = {
    pages: () => [helper, target],
    waitForEvent: (name, options) => { assert.equal(name, 'page'); assert.equal(options.timeout, 10000); order.push('listen'); return Promise.resolve(target); },
  };
  const action = runInNewContext(`(${backgroundTabCode(url)})`);
  const result = await action({ context: () => context });
  assert.equal(navigated, url);
  assert.deepEqual(order, ['create', 'listen', 'navigate']);
  assert.equal(result.selectedTabUnchanged, true);
  assert.equal(result.tabId, 20);
  let cleanedUp = false;
  const originalEvaluate = helper.evaluate;
  helper.evaluate = async (fn, arg) => {
    if (arg === 20) { cleanedUp = true; return; }
    return originalEvaluate(fn, arg);
  };
  target.goto = async () => { throw Error('navigation rejected'); };
  await assert.rejects(action({context: () => context}), /navigation rejected/);
  assert.equal(cleanedUp, true);
  const missing = cli(['tab-new-background']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage:/);
});
