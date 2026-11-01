---
name: run-fitnotes
description: Build, run, start, screenshot and drive the fitNotes app, and run its tests. Use when asked to launch fitNotes, take a screenshot of a screen, try a change in the real app, log an entry, check the muscle map, test offline behaviour, or run the unit or end-to-end tests.
---

fitNotes is an offline-first iPhone web app. Drive it with `.claude/skills/run-fitnotes/driver.mjs`, which builds it, serves the production build and runs it in headless Chrome at iPhone size, taking one command per line on stdin. All paths are relative to the repo root.

## Prerequisites

Node 24, matching `deploy.yml`, and Chrome at `/usr/bin/google-chrome`. Set `CHROME` if it is elsewhere. No system packages or `xvfb` are needed.

## Setup

```bash
npm ci
```

## Run (agent path)

Pipe a script to the driver. Each run takes about 4 seconds, plus the commands, and starts with an empty app.

```bash
node .claude/skills/run-fitnotes/driver.mjs <<'EOF'
bodyweight 80
find Incline Dumbell Press
log Incline_Dumbbell_Press 30 8
text
go map
tap 0
text
ss map
errors
EOF
```

It exits 1 if any command printed `FAILED` or the page logged an error. Screenshots go to `/tmp/fitnotes-shots/`, or `SHOTS`, and their paths are printed. Open them: the muscle colours appear only there, not in `text`.

| Command | What it does |
|---|---|
| `go <route>` | `home`, `search`, `map`, `settings`, `log/<id>` or `exercise/<id>` |
| `find <query>` | Opens search, types the query, prints the top 8 results |
| `log <id> <kg> <reps> [YYYY-MM-DD]` | Saves an entry and stays on the exercise screen |
| `bodyweight <kg>` | Sets bodyweight in Settings |
| `tap [n]` | On the map, opens the numbers for the Nth polygon with data |
| `click <css or text>` | Clicks a selector, or else the visible text |
| `fill <css> <value>` | Types into a field |
| `press <css> <key>` | Presses a key in a field, such as `Enter` |
| `text` | Prints the visible text of the screen |
| `ss [name]` | Takes a screenshot |
| `offline on\|off` | Cuts or restores the network |
| `reload` | Reloads the page |
| `eval <js>` | Runs JavaScript in the page and prints the result |
| `errors` | Prints console and page errors so far |
| `quit` | Stops. End of input does the same. |

To check offline behaviour, go offline, reload, and carry on:

```bash
node .claude/skills/run-fitnotes/driver.mjs <<'EOF'
bodyweight 80
log Barbell_Deadlift 120 5
offline on
reload
log Pullups 0 3
offline off
reload
go home
text
EOF
```

To work step by step, run it under tmux. Wait for `ready`, then for what each command should print before reading the pane, because commands take a moment:

```bash
tmux new-session -d -s fitnotes -x 120 -y 50
tmux send-keys -t fitnotes 'node .claude/skills/run-fitnotes/driver.mjs' Enter
timeout 30 bash -c 'until tmux capture-pane -t fitnotes -p | grep -q "^ready "; do sleep 0.2; done'
tmux send-keys -t fitnotes 'find bench' Enter
timeout 10 bash -c 'until tmux capture-pane -t fitnotes -p | grep -q "Bench Press"; do sleep 0.2; done'
tmux capture-pane -t fitnotes -p
tmux send-keys -t fitnotes 'quit' Enter
tmux kill-session -t fitnotes
```

## Direct invocation

For catalogue work, read rows without launching anything. The ids are what `log` and `go` take.

```bash
node -e "console.log(require('./src/data/exercises.json').find((row) => row.id === 'Overhead_Squat'))"
node -e "for (const r of require('./src/data/exercises.json')) if (/incline/i.test(r.name) && /press/i.test(r.name)) console.log(r.id)"
```

## Run (human path)

```bash
npm run dev
```

It prints a local and a network address, so a phone on the same network can open it. Stop with Ctrl-C. This path has no service worker.

## Test

```bash
npm test                               # 745 tests, about 6 s
npx vitest run src/data/index.test.ts  # one file
npm run e2e                            # 36 checks of the "Done when" flow, about 16 s
npm run check                          # what the deploy job runs: types, tests, build
```

`npm run e2e` covers backup, restore and reinstall against a fake GitHub in `e2e/smoke.mjs`. Neither it nor the driver covers iPhone Safari.

## Gotchas

- **The driver cannot reach GitHub.** It blocks `api.github.com` so it can never touch the real backup. A token shows "Cannot reach GitHub" in Settings, which is expected. Test backup with `npm run e2e`.
- **Nothing carries over between runs.** Each run is a fresh install, so seed it with `bodyweight` and `log` first. Fresh numbers come from the starting curve, not your real logs.
- **An unknown or dropped id renders a blank screen, not an error.** `text` prints nothing, and `log` fails after 5 seconds.
- **`tap` counts polygons, not muscles.** Each muscle has several: one logged lift gave 10. Check the name with `text` after tapping.
- **`fill` and `press` split on spaces,** so their selector cannot hold one. Use `input[type=password]`, not `[aria-label="GitHub token"]`. `click` takes spaces.
- **On bodyweight lifts, `log` takes added weight,** negative for assistance. `log Pullups 0 3` then predicts negative weights, shown with a `−` sign, not `-`.
- **Vite moves to the next port if 5173 is taken,** which can happen when another project's dev server is running. Read the address `npm run dev` prints.

## Troubleshooting

- **`Something already answers on http://127.0.0.1:5198/`**: another run or server holds the port. Stop it, or set `PORT`.
- **`FAILED: locator.fill: Timeout 5000ms exceeded.`** after `log`: no row has that id. Look it up with the commands in Direct invocation.
- **`Unexpected token "" while parsing css selector`**: the selector has a space. See Gotchas.
- **`Failed to launch chromium because executable doesn't exist`**: set `CHROME` to the browser's path.
- **vitest exits 1 with `ReferenceError: window is not defined` and every test passing**: a teardown race in `src/App.test.tsx`, seen in about 1 run in 10. Run it again. A deploy job that fails this way needs a re-run.
