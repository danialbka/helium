# Helium Playwright benchmarks — 2026-09-28

Environment: installed Helium 0.18.1.1, official extension 0.4.0, CLI 0.1.21,
locked Playwright core 1.64.0-alpha-1789764292000, Node v26.0.0, macOS.
Baseline launcher: commit `12f4478`. All live measurements reuse the same Helium
profile and official extension session. No skills are needed by the harnesses.
Private raw samples live in `agent/.local/benchmarks/` (Git ignored, files mode 600).

## Isolating launcher overhead

First run kept the existing upstream `timeouts.settle=500` configuration. Five
already-loaded public search/Commons pages were read for title and body length;
nonempty results were checked. One warmup and five alternating measured trials.
This is a page-reading benchmark, not a complete search/navigation benchmark.

| Same work | Old launcher median | New launcher median | Calls |
| --- | ---: | ---: | ---: |
| Read five pages, separate calls | 4,005 ms | 3,097 ms | 5 |
| Read five pages, one batched call | 811 ms | 624 ms | 1 |

All 20 measured trials passed. The launcher alone reduced these wall times by
about 23%; batching saved another roughly 80% relative to separate calls.
Do not attribute the batching gain to the launcher implementation.

A separate count-only command produced 12 bytes in raw mode and 129 bytes in
verbose mode, with identical successful results over five trials per case.
That is 90.7% fewer output bytes. **Bytes are not measured model tokens**, and the
reduction depends on the result size. Raw output was already a baseline feature.

## Native settle=0 results

After applying the native configuration and reconnecting once, the same
five-page workload passed all 20 measured trials. Five alternating samples per
variant/mode; one warmup. Times below include CLI startup and browser work.

| Mode | Old launcher median (range) | New launcher median (range) |
| --- | ---: | ---: |
| Five separate calls | 1,355 ms (1,301–1,407) | 403 ms (398–414) |
| One batched call | 277 ms (270–284) | 82 ms (76–90) |

This isolates a roughly 70% launcher improvement with settling disabled. The
full progression from old launcher + five calls + default settling (4,005 ms)
to new launcher + batching + settle=0 (82 ms) is about 49x for this already-loaded
page-reading task. It is not a universal browsing speedup or a navigation measure.
Sequential and batched output stayed at 352 and 323 bytes respectively.

## Forms, filtering, delayed responses and downloads

Four independent loopback pages exercise a form submit, catalog filtering and
pagination, a fetch started after 300 ms with a 600 ms server delay, and a real
browser download. Input uses normal Playwright locators and actionability.
Downloaded file contents are checked exactly. Both launchers use settle=0 here.
Setup and cleanup are outside the timed task interval.

| Four-workflow set | Old launcher median | New launcher median |
| --- | ---: | ---: |
| Four separate calls | 2,941 ms | 2,046 ms |
| One call, workflows ordered | 2,035 ms | 1,833 ms |
| One call, independent pages parallel | 1,797 ms | 1,520 ms |

**30/30 measured trials passed**, plus both warmups. Selection stayed unchanged
before tab creation, after creation and after work in every trial. All 30 measured
downloads matched the expected content and test tabs/files were cleaned up.

A final alternating experiment compared ordinary locator polling against arming
`waitForResponse` before the triggering click, then checking the resulting UI.
The same four workflows in parallel took **1,528 ms versus 1,101 ms** (28% lower).
All ten measured trials and both warmups passed. Ranges were 1,526–1,553 ms and
1,081–1,151 ms. The response wait is useful when the expected request is known;
it does not replace checking the visible result. The fixture deliberately retains
900 ms of delayed work, so this latency cannot be removed without changing the task.

### Problems found and resolved

Early diagnostic runs exposed intermittent main-world evaluation stalls when a
background tab navigated before the official extension attached. Creating an
inactive blank tab, attaching it, and then using native `Page.goto` resolved the
observed stalls. `tab-new-background` makes that sequence available generally.
The failed diagnostic runs are excluded from the successful latency tables.

A subsequent `about:blank` target check coincided with a Helium crash
(`EXC_BREAKPOINT`/`SIGTRAP` in the macOS report). The background command now
rejects non-HTTP(S) targets before browser activity. The native browser fault
has not been fixed or conclusively localized; the HTTP(S) measurements above
remain scoped to the successful runs.
Helium's Restore action recovered the main window, local editor and public
image-search tabs. A subsequent HTTPS background-tab creation, main-world read
and cleanup passed with the selected user tab unchanged. All seven launcher
regression tests passed with the new URL guard.

The current extension connection did **not** emit Playwright's `download` event,
even after the attachment fix. A separate probe timed out waiting for that event
while the file in Downloads had the exact expected content. The workflow benchmark
therefore uses a real link click and bounded filesystem completion checks, not
`download.saveAs()`. No native download-event success is claimed.

Seven offline regression tests cover flags, session selection, cross-directory
invocation, split-write/encoded-token redaction, large output, output limits,
an unresponsive isolated daemon, and background-tab URL quoting/order.

## Further experiments

- **Native settle configuration:** upstream wraps actions in a 500 ms settling
  wait and may add another wait when requests occur. Setup now uses the native
  `timeouts.settle=0` setting. Locator actionability remains enabled. Delayed UI
  must be awaited explicitly; an immediate snapshot can show an intermediate state.
- **Node compilation cache:** 30 alternating samples per variant after three
  warmups, using `--version` without browser activity. Median 59.32 ms without
  cache versus 58.94 ms with it (0.6%). Ranges overlapped (57.25–64.36 versus
  56.76–65.19 ms). No cache configuration was added for this negligible result.

- **CommonJS startup prototype:** 30 alternating offline samples per variant
  showed 58.19 ms for ESM versus 56.68 ms for a temporary CommonJS port, with
  overlapping ranges (57.18–60.95 versus 54.94–59.69 ms). A 1.5 ms startup saving
  did not justify maintaining another entrypoint format. The background-tab helper
  is instead loaded only for its command, keeping ordinary command startup small.

## Reproduce

From `agent/`, with the existing Helium connection available:

```sh
node scripts/freeze-baseline.mjs
node --test tests/*.test.mjs
node benchmarks/public-read.mjs
node benchmarks/output-modes.mjs
node benchmarks/workflows.mjs
HELIUM_BENCH_EXPERIMENT=event-wait node benchmarks/workflows.mjs
node scripts/benchmark-startup.mjs
```

Run timing harnesses one at a time. Public reads require the five previously
opened public Google, Bing, DuckDuckGo, Yandex and Commons pages in the agent
context. The workflow harness serves deterministic pages on loopback, creates
its own background tabs, verifies form/catalog/delayed-fetch results and exact
downloaded file contents, then removes only its own tabs and generated files.
Downloads use unique filenames in the browser's existing download directory
(default `~/Downloads`; override `HELIUM_BENCH_DOWNLOAD_DIR` when needed).
The harness checks filesystem completion because this extension connection
did not emit Playwright's download event. Setup/cleanup time is
excluded from its task timings. Environment overrides for trials and launcher
paths are documented at the top of each script.

## Limits and stopping criteria

These are local command/browser measurements, not end-to-end Codex model latency
or measured token bills. Website/network latency, model reasoning, captchas,
accounts and browser throttling remain outside these results. Signed-in account
workflows, uploads, purchases and arbitrary sites are not certified by this suite.

Keep optimizations when repeated correct trials show a useful gain. Stop a pass
when remaining candidates are noise, require bypassing actionability/readiness,
or require replacing the official transport with a custom browser daemon.
There is no claim that every possible browser workload is maximally optimized.

Initial/reconnection focus changes are separate from steady-state background
work. Active-tab protection remains deferred.
