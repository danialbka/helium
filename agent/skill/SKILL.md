---
name: helium-playwright
description: Use the official Playwright CLI to browse and automate visible Helium from terminal Codex, with an isolated tab group per conversation. Use for Helium browser automation.
---

Use `~/.local/bin/helium-playwright`. It uses the normal visible Helium profile
and the official Playwright extension. Headless automation is disabled at the
owner's request. The official `playwright-cli` is also installed in `~/.local/bin`.

```sh
~/.local/bin/helium-playwright connect
~/.local/bin/helium-playwright tab-list
~/.local/bin/helium-playwright tab-new https://example.com
~/.local/bin/helium-playwright snapshot
~/.local/bin/helium-playwright click e6
~/.local/bin/helium-playwright run-code 'async page => ({title: await page.title(), url: page.url()})'
```

`connect` automatically uses a stable session per `CODEX_THREAD_ID` (or terminal
identity), reusing its helper tab and group in visible Helium. The
official Playwright Extension is unmodified. Do not set one shared session name
across independent terminals; `HELIUM_PLAYWRIGHT_SESSION` is an explicit override. The CLI may label the protocol channel `chrome`; the actual
executable is Helium. Use `--help` or `<command> --help` for upstream commands.

Tabs: reuse, never duplicate. The owner does not want the same page opened twice.

- `connect` prints the tabs this conversation already has (`tabs`, with the
  index to pass to `tab-select`). After a detach, a crash or a browser restart it
  hands the conversation's earlier tabs back (`adopted`). Read that list first.
- If the page you need is listed, `tab-select <index>` and carry on there. If a
  tab is on the same site, select it and `goto` the new address instead of
  opening another tab.
- `tab-new <url>` selects the existing tab when this conversation already has
  that page open and prints `{"reused":true,...}`. Pass `--new` only when two
  copies of one page are really needed.
- Do not `goto` in tab 0 (the extension's helper tab); open a tab for the task.
- Never `detach` and `connect` again to get past an error: fix the command.
  Close tabs you opened for throwaway checks with `tab-close`.
- Helper tabs close themselves when their connection ends; do not open or close
  them yourself.

Background work: tabs open unselected and commands do not bring Helium or a tab
to the front, so the owner keeps working in their own tab. Clicks, typing,
snapshots and screenshots work in unselected tabs. Do not call
`page.bringToFront()` or otherwise select a tab for the owner unless they ask to
watch. `HELIUM_PLAYWRIGHT_FOREGROUND=1` restores bring-to-front for one command
set when the owner asks for it.

Keep browser work fast and concise:

- Connect once per task; reuse the session between actions. Do not reconnect or
  enumerate all tabs after every command.
- Output uses native `--raw`: results/errors only. `--json` is available for
  machine parsing.
- Batch a known sequence of actions and its final check in one `run-code` call.
  Return a small object with only the answer or outcome needed by the task.
- Prefer `find "text"`, `snapshot "main" --depth=3`, or a targeted locator read
  over whole-page snapshots. Get a full snapshot only when discovering an unknown
  interface. Do not dump HTML, all network traffic, or broad page text by default.
- Use Playwright locators and their built-in waits. Avoid sleeps, repeated status
  polling, and `networkidle` for ordinary navigation; use `domcontentloaded` plus
  a wait for the specific content needed.
- Batch independent reads with `Promise.all`; keep dependent actions sequential.
- Take screenshots only for visual questions or when textual inspection fails.

- Start with `connect` and use the tab list it prints; `tab-list` shows it again.
- Refresh a relevant snapshot when navigation or DOM changes invalidate refs.
- Use the normal visible Helium profile and its existing logins. Never copy or
  delete profiles or cookies. Normal task authorization still applies to sending,
  purchasing, deleting, and other external actions.
- Each conversation has its own `Codex · <session>` group. Work within that group;
  do not move another terminal's tabs into it.
- `detach` disconnects the CLI. Reuse the stable session when reconnecting.
- `run-code` receives a real Playwright `page`; use standard locators and APIs.
- Use `locator.setInputFiles("/absolute/file")` for file inputs (50 MiB total
  transfer limit). After clicking a file picker, use `upload /absolute/file`
  or `upload` with no paths to cancel before other page commands. Compact output
  reports pending modal state. `Buffer` is not a global in `run-code`.
- Sandbox-denied browser launches, sockets, or network access need the caller
  tool's normal permission escalation. Do not reinstall, reset the profile, or
  retry the same denied operation as a browser connection repair.
- Use absolute paths for screenshots/files: the wrapper's stable working directory
  is the integration's `agent/` directory, not the shell's current project.
- `detach` disconnects the agent while preserving the browser. Avoid browser-wide
  shutdown, profile deletion, or replacing this with an isolated Chrome session.
- Do not start `headless-host.mjs` or enable `HELIUM_PLAYWRIGHT_HEADLESS`.
  The default launcher clears inherited headless settings before invoking the CLI.

For the official CLI reference, read
`/Users/danialbka/projects/heliumcustom/agent/node_modules/@playwright/cli/skills/playwright-cli/SKILL.md` as needed. If that location moves, resolve the `~/.local/bin/helium-playwright` symlink and locate the installed CLI reference in its integration directory; do not assume a skill-relative `node_modules` directory.

The CLI may refuse privileged browser-management or extension-origin pages. Check the current error/help and use an available documented native-app tool for those surfaces. Do not disable the CLI's restrictions or treat a content-page test as an installed-extension test. Helium is useful for debugging; it does not substitute for Google Chrome Stable or Firefox when the repository's store qualification requires those browsers.
