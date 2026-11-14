# Personal Helium fork

The owner requested this fork for local Helium integration with the official
Playwright CLI and terminal Codex. Work on that integration is authorized.

- Keep integration code in `agent/`; preserve the upstream browser patchset.
- Use the official Playwright CLI and extension wherever possible.
- Use visible Helium with the official extension. Each Codex conversation owns
  its own CLI session and tab group. Headless automation is disabled at the
  owner's request. Never copy or delete browser profiles.
- The owner asked (2026-11-14) for no duplicate tabs, reuse of existing tabs, and
  background work that leaves their current tab and application in front. Keep
  these behaviors (`agent/lib/tabs.mjs`, background mode on by default).
- Nothing stops an agent that deliberately selects or drives the owner's own
  tabs; do not claim such protection exists.
- Never submit AI-generated contributions to imputnet repositories.
- Keep tokens, browser state, snapshots, and machine-specific config out of Git.
- Verify browser integration using Helium and report what was actually exercised.
