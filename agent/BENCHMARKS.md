# Deferred real-world benchmark

Requested for later; not run as part of setup. Active-tab protection remains out
of scope until requested again.

Compare the same official CLI and Helium session in two modes: ordinary verbose
one-action-at-a-time use, and the compact/batched workflow taught by this skill.
Use the same pages, account, task, and starting state. Measure a cold connection
separately from work using an existing connection. Alternate mode order and run
each case at least three times; keep raw measurements as well as medians.

| Task | Completion evidence |
| --- | --- |
| Research a topic across 3 public sites | Relevant answer with the 3 source URLs |
| Find a specific item in a long catalog | Correct item and requested details |
| Use filters and pagination in a dashboard | Correct visible result after filters |
| Fill a multi-step form in a local demo | Final state matches the entered values |
| Read a signed-in dashboard | Requested values without exporting cookies |
| Download a public document | Local file exists and has the expected content |
| Complete one task while another tab stays selected | Task result and selected-tab evidence |
| Detach, reconnect, and continue | Same profile, preserved login, correct result |

Record task success, wall time, CLI invocations, browser actions, model tool calls,
model token counts if available, output bytes, retries, and any focus changes.
Output bytes are a proxy; do not label them measured model tokens. Report browser
or extension restrictions and task failures without hiding them in averages.

Use public data or explicitly authorized account reads. Transactions, messages,
uploads, and destructive actions require task-specific authorization. Save private
account evidence under `.local/`; publish only aggregate measurements.
