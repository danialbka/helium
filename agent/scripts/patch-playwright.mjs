import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The extension uses connectOverCDP({noDefaults:true}), skipping focus emulation.
// Background animation frames then stop and normal actionability checks hang.
// Restore only this existing Playwright behavior, opted in by our launcher.
export async function patchPlaywright() {
  const root = new URL('../node_modules/playwright-core/', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  if (pkg.version !== '1.64.0-alpha-1789764292000')
    throw new Error(`Unsupported Playwright version ${pkg.version}; review the background-tab patch before updating.`);
  const file = fileURLToPath(new URL('lib/coreBundle.js', root));
  const original = 'if (this._isMainFrame() && !skipDefaultOverrides)\n            promises2.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));';
  const replacement = 'if (this._isMainFrame() && (!skipDefaultOverrides || process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1"))\n            promises2.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));';
  const source = await readFile(file, 'utf8');
  if (source.includes(replacement)) return;
  if (source.split(original).length !== 2)
    throw new Error('Playwright focus-emulation patch did not match exactly once. No files changed.');
  await writeFile(file, source.replace(original, replacement));
}
