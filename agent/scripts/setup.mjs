#!/usr/bin/env node
import { access, chmod, lstat, mkdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { patchPlaywright } from './patch-playwright.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
const executablePath = process.env.HELIUM_EXECUTABLE || '/Applications/Helium.app/Contents/MacOS/Helium';
const profile = process.env.HELIUM_PROFILE || 'Default';
await access(executablePath);
await access(path.join(root, 'node_modules/@playwright/cli/playwright-cli.js'));
await patchPlaywright();
await mkdir(local, { recursive: true, mode: 0o700 });
await chmod(local, 0o700);
await mkdir(path.join(local, 'artifacts'), { recursive: true, mode: 0o700 });
await writeFile(path.join(local, 'settings.json'), JSON.stringify({ executablePath, profile }, null, 2) + '\n', { mode: 0o600 });
await writeFile(path.join(local, 'cli.config.json'), JSON.stringify({
  browser: { browserName: 'chromium', contextOptions: { viewport: null } },
  outputDir: path.join(local, 'artifacts'),
  // Use Playwright locator/event waits rather than a fixed delay after each tool.
  timeouts: { settle: 0 },
}, null, 2) + '\n', { mode: 0o600 });

if (process.argv.includes('--token-stdin')) {
  let token = '';
  for await (const chunk of process.stdin) token += chunk;
  token = token.trim().replace(/^PLAYWRIGHT_MCP_EXTENSION_TOKEN=/, '');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Expected the token from the official Playwright Extension status page.');
  await writeFile(path.join(local, 'auth-token'), token + '\n', { mode: 0o600 });
  await chmod(path.join(local, 'auth-token'), 0o600);
}

async function link(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const stat = await lstat(destination);
    if (stat.isSymbolicLink() && path.resolve(path.dirname(destination), await readlink(destination)) === source) return;
    throw new Error(`Refusing to replace existing path: ${destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await symlink(source, destination);
}
const bin = path.join(os.homedir(), '.local/bin');
await chmod(path.join(root, 'bin/helium-playwright.mjs'), 0o755);
await link(path.join(root, 'bin/helium-playwright.mjs'), path.join(bin, 'helium-playwright'));
await link(path.join(root, 'node_modules/@playwright/cli/playwright-cli.js'), path.join(bin, 'playwright-cli'));
const skill = path.join(root, 'skill');
await link(skill, path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/helium-playwright'));
// The current CLI also discovers the cross-agent personal skills directory.
await link(skill, path.join(os.homedir(), '.agents/skills/helium-playwright'));
console.log(`Installed official playwright-cli and helium-playwright in ${bin}`);
console.log('Installed the helium-playwright skill for terminal Codex. Start a new Codex session to discover it.');
console.log('Run helium-playwright connect. The official extension must be installed in Helium.');
console.log('Active-tab protection is not implemented.');
