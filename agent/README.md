# Helium + official Playwright CLI

This personal Helium fork includes a local integration with Microsoft's
Playwright CLI and official Playwright Extension. It controls the installed Helium
browser, using the existing profile and logins. No Chromium rebuild or remote
debugging port is required. The browser binary itself is unchanged.

One version-checked, opt-in compatibility patch restores Playwright's existing
focus emulation for background tabs. The official extension's `noDefaults` mode
otherwise skips this, allowing background rendering to stop and normal clicks to
time out. The patch does not select tabs or bypass actionability checks. It is
applied by setup and enabled only by `helium-playwright`; the extension is unchanged.

Active-tab protection is deferred. There is no automatic pause when you select an
agent tab. The official extension organizes each client's tabs in a Playwright
group; that is not an active-tab safety boundary.

## Install on macOS

```sh
cd agent
npm ci
npm run setup
```

Install the [official Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)
in Helium. Then run `helium-playwright connect` and allow its connection. Setup
installs both `playwright-cli` and `helium-playwright` into `~/.local/bin`, and
installs a discoverable Codex skill. Add that bin directory to PATH if needed.

Set `HELIUM_EXECUTABLE` and `HELIUM_PROFILE` when running setup if the application
path or profile differs from `/Applications/Helium.app/Contents/MacOS/Helium` and
`Default`. These settings only select the existing browser; profiles are not copied.

For automatic reconnects, copy the token shown on the extension's status page
and provide it on stdin to `node scripts/setup.mjs --token-stdin` (finish with
Ctrl-D), or run `node scripts/pair.mjs` after the initial connection. The latter
reads only the extension's own authentication token through Playwright and stores
it in `.local/auth-token` with mode 600. `.local/` has mode 700 and is Git-ignored.
Regenerating the token in the extension invalidates the stored token; pair again.

## Ask terminal Codex

Start a new Codex session after setup, then ask naturally:

> Use Helium to open example.com in an agent tab and tell me its title.

The `helium-playwright` skill is available for automatic discovery. You can also
explicitly invoke `$helium-playwright`. Existing conversations may need restarting
to discover newly installed skills.

## Native CLI commands

```sh
helium-playwright connect
helium-playwright tab-new-background https://example.com
helium-playwright snapshot
helium-playwright click e6
helium-playwright run-code 'async page => await page.title()'
helium-playwright detach
```

Apart from `connect` and `tab-new-background`, arguments are passed straight to the official CLI command client. `connect`
reuses the named session or calls `playwright-cli -s=helium attach --extension=chrome`
with `PLAYWRIGHT_MCP_EXECUTABLE_PATH` pointing to Helium. `chrome` is the protocol
channel label, not the browser executable. Set `HELIUM_PLAYWRIGHT_SESSION` to use
another session name. Commands run from a stable local workspace, so they work
across terminal projects; use absolute file paths for exports.

`tab-new-background <http(s)-url>` creates a blank inactive tab in the helper's window,
attaches it to the official extension group, then navigates with native
`Page.goto`. This ordering avoids a navigation/attachment race observed in the
benchmarks. It returns the tab index, ID, URL, title and whether selection stayed
unchanged. Target that page through `page.context().pages()` in `run-code` for
background work. The helper tab must remain available. This command is a small
adapter using the official extension and Playwright APIs. It rejects non-HTTP(S)
targets before creating a tab: a final `about:blank` navigation check coincided
with a Helium browser crash. This guard avoids that tested path; it is not a
fix to the browser binary.

Output defaults to the CLI's `--raw` mode to keep agent token use low. Use
`--verbose` to restore the upstream code blocks and page summaries, or `--json`
for machine parsing. Authentication tokens are redacted from terminal output.
For any browser task, reuse the connection, batch related operations with
`run-code`, return only needed fields, and use targeted snapshots. These are
ordinary CLI operations and do not require a skill.

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
and `run-code` were exercised successfully. Initial connection and creating tabs
can select a tab; ongoing background actions do not need to select it.

## Fast execution

The launcher runs the pinned official modular command client in one Node process.
It skips the outer executable's large bundle import, update notifier, and skill
lookup. Browser commands, argument validation, daemon transport, locators, and
errors remain upstream implementations. `playwright-cli` itself is still the
unchanged upstream executable. Reused `connect` checks the actual daemon with
`tab-list`; an unresponsive check fails after 10 seconds without reconnecting over
an active task. Output is bounded to 32 MiB and redacted, including split writes.

Setup sets the native `timeouts.settle` option to `0` (upstream defaults to
500 ms). This removes the blanket post-action delay, while keeping locator
actionability and navigation timeouts. A click may return before a delayed fetch
or UI update, so wait for the expected result explicitly before reading it. To
restore the upstream delay, set `timeouts.settle` to `500` in
`agent/.local/cli.config.json`, then detach and reconnect. A reconnect can briefly
select the extension tab; it is not required for ordinary commands.

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
- Work in agent tabs and avoid `bringToFront`. Active-tab protection is still deferred.

## Setup verification (2026-09-28)

Verified on installed Helium 0.18.1.1, official extension 0.4.0, and CLI 0.1.21:
token-based detach/reconnect without another approval dialog; commands from a
different working directory; navigation; snapshots; and a form fill and normal
locator click while a different tab remained visibly selected. The background
test used real browser input with Playwright's normal actionability checks.
The Codex skill passed its validator; a fresh Codex task has not been benchmarked.

See [repeatable benchmarks and results](BENCHMARKS.md).

## Remove

Detach the CLI, remove the two symlinks in `~/.local/bin` and the
`helium-playwright` skill symlinks in `~/.codex/skills` and `~/.agents/skills`, then
remove the Playwright Extension in Helium. The browser profile stays intact.
