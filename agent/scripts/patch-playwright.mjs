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
  let source = await readFile(file, 'utf8');
  // Upgrade the earlier installed window patch as well as pristine npm installs.
  source = source.replace('if (process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1") args.push("--new-window");\n        args.push(href);', 'args.push(href);');
  const patches = [
    [original, replacement],
    // chrome.debugger does not support DOM.setFileInputFiles. Use Playwright's
    // existing remote-browser file transfer (bounded to 50 MiB), not host paths.
    ['const browser = await playwright.chromium.connectOverCDP(relay.cdpEndpoint(), { isLocal: true, timeout: 0, noDefaults: true });',
     'const browser = await playwright.chromium.connectOverCDP(relay.cdpEndpoint(), { isLocal: process.env.HELIUM_PLAYWRIGHT_BACKGROUND !== "1", timeout: 0, noDefaults: true });'],
    // A chooser/dialog is actionable state even when compact output is selected.
    ['const rawSections = ["Error", "Result", "WebMCP tools", "Snapshot"];',
     'const rawSections = ["Error", "Result", "WebMCP tools", "Snapshot", ...(process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1" ? ["Modal state", "Paused"] : [])];'],
    // The underlying upload tool already supports cancellation by omitting paths.
    ['files: stringArrayArg.describe("The absolute paths to the files to upload")',
     'files: (process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1" ? stringArrayArg.optional() : stringArrayArg).describe("The absolute paths to the files to upload; omit to cancel the chooser")'],
    // Reuse the one persistent headless Helium process. Tokens stay on a private
    // Unix socket instead of browser command-line arguments.
    ['args.push(href);', 'if (process.env.HELIUM_PLAYWRIGHT_HEADLESS === "1") {\n          const host = await import(process.env.HELIUM_PLAYWRIGHT_HEADLESS_MODULE);\n          await host.openHeadlessConnectPage(href);\n          return;\n        }\n        args.push(href);'],
    // New tabs open unselected, in the automation group's own window, so the
    // tab the owner is using stays in front.
    ['const tab2 = await this._sendToExtension("chrome.tabs.create", [{ url: url3 }]);',
     'const owner = process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1" ? [...this._knownTabs.values()].find(tab => tab.url?.startsWith("chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/")) : null;\n        const tab2 = await this._sendToExtension("chrome.tabs.create", [{ url: url3, ...(process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1" ? {active: false, ...(Number.isInteger(owner?.windowId) ? {windowId: owner.windowId} : {})} : {}) }]);'],
    // Ask the official connect page not to select its tab or focus the window.
    ['url3.searchParams.set("protocolVersion", this._protocolVersion.toString());',
     'url3.searchParams.set("protocolVersion", this._protocolVersion.toString());\n        if (process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1") url3.searchParams.set("background", "true");'],
    // Hand the connect page to the running browser without activating the app.
    ['(0, import_child_process5.spawn)(executablePath, args, {\n          windowsHide: true,',
     'const quiet = process.env.HELIUM_PLAYWRIGHT_BACKGROUND === "1" && process.platform === "darwin" && executablePath.includes(".app/Contents/MacOS/");\n        (0, import_child_process5.spawn)(quiet ? "/usr/bin/open" : executablePath, quiet ? ["-g", "-a", executablePath.slice(0, executablePath.indexOf(".app/") + 4), href, "--args", ...args.slice(0, -1)] : args, {\n          windowsHide: true,'],
    // Select the CLI target without selecting it in the user's browser UI.
    ['await tab2.page.bringToFront();\n        await tab2.updateWebMCPTools();', 'if (process.env.HELIUM_PLAYWRIGHT_BACKGROUND !== "1") await tab2.page.bringToFront();\n        await tab2.updateWebMCPTools();'],
  ];
  for (const [before, after] of patches) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2)
      throw new Error('Playwright compatibility patch did not match exactly once. No files changed.');
    source = source.replace(before, after);
  }
  await writeFile(file, source);
}
