# Helium + official Playwright CLI

This personal Helium fork includes a local integration with Microsoft's
Playwright CLI and official Playwright Extension. It controls the installed Helium
browser visibly with the unmodified official extension. Each Codex conversation
gets its own CLI session, helper tab, and tab group. Headless automation is disabled
at the owner's request. The default launcher forwards to the existing visible
Helium integration and clears inherited headless environment settings.

## Install on macOS

### Visible-browser work (default)

`bin/helium-playwright-visible.mjs` uses the normal Helium profile and the official
extension, with a separate named tab group. It does not use the headless host.

```sh
node bin/helium-playwright-visible.mjs -s=my-visible-task connect
node bin/helium-playwright-visible.mjs -s=my-visible-task load-extension /absolute/build/folder --restart
node bin/helium-playwright-visible.mjs -s=my-visible-task tab-new https://example.com
```

`load-extension` requires a stable manifest key. With `--restart`, it gracefully
restarts only the verified normal-profile Helium process, restores its session,
and loads that exact folder without disabling other extensions. It refuses a
headless/custom-profile process and never force-kills a process. Use this restart
option only when restarting the visible browser is authorized.

The official extension cannot automate other extensions' pages or
`chrome://extensions`. For installation verification, the visible launcher also
opens a loopback-only, dynamically assigned Playwright debugging endpoint and
checks the installed extension's runtime ID/version. It closes that verification
tab and disconnects direct Playwright before connecting the caller's group;
concurrent direct and extension-bridge connections can detach each other.
Ordinary forwarded CLI commands still use the official
extension bridge and retain its URL restrictions. The local debugging endpoint
lasts until the visible browser exits. No browser profiles or cookies are copied.

### Setup

```sh
cd agent
npm ci
npm run setup
```

Install the [official Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
in Helium. Then run `helium-playwright connect` and allow the extension connection
if prompted. Setup
installs both `playwright-cli` and `helium-playwright` into `~/.local/bin`, and
installs a discoverable Codex skill. Add that bin directory to PATH if needed.

Set `HELIUM_EXECUTABLE` and `HELIUM_PROFILE` when running setup if the application
path or profile differs from `/Applications/Helium.app/Contents/MacOS/Helium` and
`Default`. These settings only select the existing browser; profiles are not copied.

Existing browser profiles and logins are preserved. The former headless profile
is unused; the default launcher does not start a headless host.

## Ask terminal Codex

Start a new Codex session after setup, then ask naturally:

> Use Helium to open example.com in an agent tab and tell me its title.

The `helium-playwright` skill is available for automatic discovery. You can also
explicitly invoke `$helium-playwright`. Existing conversations may need restarting
to discover newly installed skills.

## Native CLI commands

```sh
helium-playwright connect
helium-playwright tab-new https://example.com
helium-playwright snapshot
helium-playwright click e6
helium-playwright run-code 'async page => await page.title()'
helium-playwright detach
```

`connect` reuses its visible session or attaches through the official extension.
Other commands are forwarded to the official CLI using the normal Helium profile.
Session names are automatic per conversation; `HELIUM_PLAYWRIGHT_SESSION` and CLI
session flags override them. Use absolute paths for exports.

The integration pins `@playwright/cli` in `package-lock.json` (the official CLI
currently depends on a Playwright alpha). Keep the lockfile when installing.

The extension and CLI handle browser transport, tab groups, reconnection, snapshots,
locators, and JavaScript execution. There is no custom CDP relay or reimplementation
of Playwright. See the [official CLI documentation](https://playwright.dev/agent-cli/commands/attach)
and [extension documentation](https://github.com/microsoft/playwright/tree/main/packages/extension).

This uses the extension's CDP bridge, so it does not expose every browser-level
Playwright operation. For example, `context.newCDPSession(page)` currently fails
in the upstream bridge. In the download benchmark, files reached Downloads but
Playwright's `download` event timed out. Use explicit filesystem completion and
content checks when relying on native browser downloads through this connection;
`download.saveAs()` is not verified here. Ordinary page navigation, locators, fill/click, snapshots,
and `run-code` were exercised successfully. Helper and task tabs use visible Helium.

## Tab reuse and background work (2026-11-14)

The owner asked for no duplicate tabs, reuse of tabs that already exist, and work
that does not take over the tab they are using. `lib/tabs.mjs` does this through
the official extension's own pages; the extension is not modified.

- `connect` returns `{tabs, adopted, closedHelpers}`. It closes helper
  (`connect.html`) tabs whose connection is gone, and moves the session's earlier
  tabs back into its group: tabs remembered by ID and address, and tabs in a
  restored group with the session's title. A tab a live connection is driving
  (listed by the extension or debugger-attached) is never moved or closed.
- The helper page remembers the group's tabs in the extension's `localStorage`
  (`helium-tabs:<session>`) and closes itself about a second after its
  connection ends.
- `tab-new <url>` selects an existing tab for the same address (or the address an
  earlier `tab-new` for that request landed on); `--new` forces a copy.
- `HELIUM_PLAYWRIGHT_BACKGROUND=1` is set by default: new tabs are created
  unselected in the group's window, `tab-select` does not bring a tab forward,
  focus emulation keeps background pages actionable, the connect page is opened
  with `open -g` and `background=true`, and the previously selected tab and
  front application are restored after a new connection. These rely on
  `scripts/patch-playwright.mjs`; rerun `npm run setup` after reinstalling
  `node_modules`. `HELIUM_PLAYWRIGHT_FOREGROUND=1` turns this off.

Exercised in visible Helium with extension 0.5.0: stale helpers closed, reuse,
return of tabs after `detach` and after a killed daemon, and click, navigation
and screenshot in an unselected tab with the owner's tab and front application
unchanged. Not exercised: a browser restart, the missing-helper repair path, and
several conversations at once. A new connection still opens its helper tab in
the frontmost Helium window, selected for a moment before selection is restored.

## Execution

The visible launcher invokes the pinned official CLI with raw output and token
redaction. Setup sets `timeouts.settle` to `0`; wait explicitly for the expected
UI or response after actions. Reuse the connection and its isolated tab group.

General workflow rules:

- Keep related navigation, input, waits, and extraction in one `run-code` call.
- Use `Promise.all` only for independent pages or reads. Keep dependent actions ordered.
- When a request is known, arm `waitForResponse` before its triggering action,
  then check the expected UI. This avoided extra locator polling in the benchmark.
- Await a meaningful result with a locator or response event before returning.
  For background `waitForFunction`, use explicit numeric polling when animation
  frames may be paused; state-based locator waits are preferable.
- Reuse a saved script via `run-code --filename=/absolute/path/task.js` for repeatable workflows.
- Return small structured results. Take a screenshot or full snapshot when needed.
- Preserve normal Playwright actionability; do not use forced clicks to save time.
- Work in the current connection's group. A different Codex terminal owns a separate group.

## Setup verification (2026-09-28)

Verified on installed Helium 0.18.1.1, official extension 0.4.0, and CLI 0.1.21:
token-based detach/reconnect without another approval dialog; commands from a
different working directory; navigation; snapshots; and a form fill and normal
locator click while a different tab remained visibly selected. The background
test used real browser input with Playwright's normal actionability checks.
The Codex skill passed its validator; a fresh Codex task has not been benchmarked.

The existing `test:browser` and `test:windows` scripts describe the previous
headless integration and are not validation of the visible default. Do not run
them as visible-browser qualification without adapting their assumptions.

See [repeatable benchmarks and results](BENCHMARKS.md).

## Remove

Detach the CLI, remove the two symlinks in `~/.local/bin` and the
`helium-playwright` skill symlinks in `~/.codex/skills` and `~/.agents/skills`, then
remove the Playwright Extension in Helium. Browser profiles stay intact.
