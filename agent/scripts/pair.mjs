#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.umask(0o077);
const root = fileURLToPath(new URL('../', import.meta.url));
const session = process.env.HELIUM_PLAYWRIGHT_SESSION || 'helium';
const cli = path.join(root, 'node_modules/@playwright/cli/playwright-cli.js');
// Use a disposable agent tab and restore the original page without navigating it.
const code = `async page => {
  const authPage = await page.context().newPage();
  try {
    await authPage.goto('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html');
    return await authPage.evaluate(() => localStorage.getItem('auth-token'));
  } finally { await authPage.close(); }
}`;
const result = spawnSync(process.execPath, [cli, `-s=${session}`, 'run-code', code], {
  cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
});
const token = result.stdout?.match(/### Result\s+"([A-Za-z0-9_-]{32,256})"/)?.[1];
if (result.status !== 0 || !token) {
  console.error('Pairing failed. Run helium-playwright connect and allow the official extension connection first.');
  process.exit(1);
}
const local = path.join(root, '.local');
mkdirSync(local, { recursive: true, mode: 0o700 });
chmodSync(local, 0o700);
const tokenPath = path.join(local, 'auth-token');
writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
chmodSync(tokenPath, 0o600);
console.log('Stored the Playwright Extension token locally. Future connections can authenticate automatically.');
