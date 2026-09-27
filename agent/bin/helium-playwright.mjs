#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.umask(0o077);

// Only connection defaults live here. Every browser action is the upstream CLI.
const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
const cli = path.join(root, 'node_modules/@playwright/cli/playwright-cli.js');
if (!existsSync(path.join(local, 'settings.json')) || !existsSync(cli)) {
  console.error(`Run npm ci && npm run setup in ${root}`);
  process.exit(1);
}
const settings = JSON.parse(readFileSync(path.join(local, 'settings.json'), 'utf8'));
const env = {
  ...process.env,
  PLAYWRIGHT_MCP_EXECUTABLE_PATH: settings.executablePath,
  PLAYWRIGHT_MCP_PROFILE_DIR_NAME: settings.profile,
  HELIUM_PLAYWRIGHT_BACKGROUND: '1',
};
const tokenPath = path.join(local, 'auth-token');
if (existsSync(tokenPath))
  env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = readFileSync(tokenPath, 'utf8').trim();
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
if (verbose) args.splice(args.indexOf('--verbose'), 1);
const hasSession = args.some(a => a.startsWith('-s=') || a.startsWith('--session=') || a === '--session' || a === '-s');
const session = process.env.HELIUM_PLAYWRIGHT_SESSION || 'helium';
const prefix = hasSession ? [] : [`-s=${session}`];
function run(command, capture = false) {
  const outputFlags = verbose || command.includes('--json') || command.includes('--raw') ? [] : ['--raw'];
  const result = spawnSync(process.execPath, [cli, ...prefix, ...outputFlags, ...command], {
    cwd: root,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // Upstream can print the extension's connect URL, including its token.
  const token = env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
  for (const stream of ['stdout', 'stderr']) {
    if (token && result[stream]) result[stream] = result[stream].replaceAll(token, '[redacted]');
  }
  if (!capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
}
let result;
if (!args.length || args[0] === 'connect') {
  if (args.length > 1) {
    console.error('Use HELIUM_PLAYWRIGHT_SESSION to name a connection. connect takes no arguments.');
    process.exit(1);
  }
  const probe = run(['tab-list'], true);
  if (probe.status === 0) {
    console.log(`Connected to Helium (session ${session}, reused).`);
    process.exit(0);
  }
  // "chrome" is the upstream protocol channel name. executablePath selects Helium.
  result = run(['attach', '--extension=chrome', `--config=${path.join(local, 'cli.config.json')}`]);
} else {
  result = run(args);
}
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
