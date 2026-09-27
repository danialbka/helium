---
name: helium-playwright
description: Use the official Playwright CLI to browse, inspect websites, fill forms, and automate the user's existing Helium session and signed-in accounts from terminal Codex. Use for requests to use Helium or perform browser tasks in the user's current browser.
---

Use `~/.local/bin/helium-playwright`. It sets the Helium executable, profile,
authentication, and a stable workspace, then invokes the Microsoft
Playwright CLI. The official `playwright-cli` is also installed in `~/.local/bin`.
One version-checked compatibility patch restores Playwright's focus emulation for
background tabs without activating them. The extension itself is unmodified.

```sh
~/.local/bin/helium-playwright connect
~/.local/bin/helium-playwright tab-list
~/.local/bin/helium-playwright tab-new https://example.com
~/.local/bin/helium-playwright snapshot
~/.local/bin/helium-playwright click e6
~/.local/bin/helium-playwright run-code 'async page => ({title: await page.title(), url: page.url()})'
```

`connect` reuses the existing session or attaches through the official Playwright
Extension in Helium. The CLI may label the protocol channel `chrome`; the actual
executable is Helium. Use `--help` or `<command> --help` for upstream commands.

Keep browser work fast and concise:

- Connect once per task; reuse the session between actions. Do not reconnect or
  enumerate all tabs after every command.
- Output defaults to native `--raw`: results/errors only. Use `--verbose` only to
  diagnose a failure; `--json` is available for machine parsing.
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

- Start with `connect`, then inspect `tab-list`. Prefer an agent tab or a new tab.
- Refresh a relevant snapshot when navigation or DOM changes invalidate refs.
- Existing cookies and logins belong to the real profile. Normal task authorization
  still applies to sending, purchasing, deleting, and other external actions.
- **Active-tab protection is deferred.** Selecting an agent tab does not suspend
  Playwright. Do not promise the user's selected tab is protected.
- The official extension exposes tabs in the client's Playwright group. The user
  can drag an existing tab into that group to make it available. It is usually
  simpler to open the same website in a new agent tab using the existing login.
- `run-code` receives a real Playwright `page`; use standard locators and APIs.
- Use absolute paths for screenshots/files: the wrapper's stable working directory
  is the integration's `agent/` directory, not the shell's current project.
- `detach` disconnects the agent while preserving the browser. Avoid browser-wide
  shutdown, profile deletion, or replacing this with an isolated Chrome session.
- If authentication fails, inspect the extension's status page. Do not print its
  token. Follow `../README.md` for pairing. Never commit snapshots or auth state.

For the official CLI reference, read
`../node_modules/@playwright/cli/skills/playwright-cli/SKILL.md` as needed.
