#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { protectOutput } from '../lib/output.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
const cli = path.join(root, 'node_modules/@playwright/cli/playwright-cli.js');
if (!existsSync(path.join(local, 'settings.json')) || !existsSync(cli)) {
  console.error(`Run npm ci && npm run setup in ${root}`);
  process.exit(1);
}
const settings = JSON.parse(readFileSync(path.join(local, 'settings.json'), 'utf8'));
Object.assign(process.env, {
  PLAYWRIGHT_MCP_EXECUTABLE_PATH: settings.executablePath,
  PLAYWRIGHT_MCP_PROFILE_DIR_NAME: settings.profile,
  HELIUM_PLAYWRIGHT_BACKGROUND: '1',
});
const tokenPath = path.join(local, 'auth-token');
if (existsSync(tokenPath))
  process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = readFileSync(tokenPath, 'utf8').trim();
protectOutput(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
if (verbose) args.splice(args.indexOf('--verbose'), 1);
const hasSession = args.some(a => a.startsWith('-s=') || a.startsWith('--session=') || a === '--session' || a === '-s');
const session = process.env.HELIUM_PLAYWRIGHT_SESSION || 'helium';
const prefix = hasSession ? [] : [`-s=${session}`];
process.chdir(root);
const require = createRequire(import.meta.url);
const cliVersion = require('@playwright/cli/package.json').version;
const coreVersion = require('playwright-core/package.json').version;
if (cliVersion !== '0.1.21' || coreVersion !== '1.64.0-alpha-1789764292000') {
  console.error('Unsupported Playwright version. Run npm ci, then npm run setup in the agent directory.');
  process.exit(1);
}

async function run(command) {
  const outputFlags = verbose || command.includes('--json') || command.includes('--raw') ? [] : ['--raw'];
  process.argv = [process.execPath, cli, ...prefix, ...outputFlags, ...command];
  // Use the pinned official command client directly. Its outer executable adds
  // a bundle import and an update check, neither needed to execute commands.
  const { program } = require('playwright-core/lib/tools/cli-client/program');
  await program({ embedderVersion: cliVersion });
}

try {
  if (!args.length || args[0] === 'connect') {
    if (args.length > 1) throw new Error('Use HELIUM_PLAYWRIGHT_SESSION to name a connection. connect takes no arguments.');
    const { Registry, createClientInfo } = require(path.join(root, 'node_modules/playwright-core/lib/tools/cli-client/registry.js'));
    const { Session } = require(path.join(root, 'node_modules/playwright-core/lib/tools/cli-client/session.js'));
    let ready = false;
    // Do not reconnect over an unresponsive daemon: it may be busy with a task.
    // Exiting also closes the native probe socket without private API patches.
    const timeout = setTimeout(() => {
      console.error('Helium connection check timed out after 10 seconds. Retry when the current task finishes.');
      process.exit(1);
    }, 10_000);
    try {
      const info = createClientInfo();
      const entry = await new Registry(new Map()).loadEntry(info, session);
      const result = await new Session(entry).run(info, { _: ['tab-list'] }, { raw: true });
      ready = !result.isError;
    } catch { /* A missing or stale session needs the official attach flow. */ }
    finally { clearTimeout(timeout); }
    if (ready) console.log(`Connected to Helium (session ${session}, reused).`);
    else await run(['attach', '--extension=chrome', `--config=${path.join(local, 'cli.config.json')}`]);
  } else if (args[0] === 'tab-new-background') {
    if (!args[1] || args[1].startsWith('-')) throw new Error('Usage: helium-playwright tab-new-background <url> [--json]');
    const { backgroundTabCode } = await import('../lib/background-tab.mjs');
    await run(['run-code', backgroundTabCode(args[1]), ...args.slice(2)]);
  } else await run(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
