# Working on this repo (for Claude and any other agent)

This is Shahar's personal dashboard: a web app on GitHub Pages
(https://shaharburg1010-bot.github.io/dashboard) plus a small sync service on his server.
You own both the data and the code. Shahar is not a programmer: explain changes to him in plain Hebrew.

## Two kinds of work
| Shahar asks for | What you change | How |
|---|---|---|
| A different number, task, debt, holding, plan | Data | HTTP calls to the sync service. Read `server/API.md` first |
| A different screen, order, label, new tile | Code | Edit files here, test, push. See below |

Showing something new always needs both: the data in the place the screen reads, and screen code that reads it.

## The data-first rule (Shahar, 27.11.2026) — applies to EVERY dashboard change
Content must be data, never code. Every list on a page (items, names, schedules, groups, photos, texts that
Shahar may want to change) is read from the stored data, and adding, removing or editing an item is done with a
`dashboard-inbox` file (see `inbox.js`) or `POST /v1/set` — no edit in this repo, no Git, no push.
Code holds only behaviour and layout: how a field is shown, defaults for missing fields, validation.
Before you build or change a page, ask: "Could Shahar later ask to add/remove/change this without a code change?"
If the answer is no, move it into the data first. Example: the plants page (`plants.js` header).

## Hard rules
1. **The repo is public.** Never commit personal data: amounts, holdings quantities, names, keys, tokens, screenshots.
   Data lives only in the SQLite file on the server.
2. **Never push with failing tests.** `node --test tests/*.test.js` must end with `fail 0`.
3. **Never force-push, never rewrite history, never push to the `prices` branch** (a GitHub Action owns it).
4. **Do not edit `sync.js`, `serverdrive.js`, `server/store.mjs` or `server/app.mjs` without asking Shahar.**
   They decide how changes merge. A mistake there loses data on every device.
5. **Never write to the `dash_*` tables directly**, and never touch `dashboard-ai-keys.json`.
6. One change per commit, with a message saying what Shahar will see differently.

## Where things are
| File | Role |
|---|---|
| `legacy.js` | All screens. `financePageHTML` builds the finance page; `shortTotal`, `mediumTotal`, `longTotal` at the top define the three ranges |
| `styles.css`, `finance.css` | Styling (finance page has its own file) |
| `model.js` | Maps screen state to stored items. `LISTS` = lists synced item by item; everything else is a block |
| `sections.js` | Which area (tasks, debts, finance, leisure, spending, diet) each piece of data belongs to |
| `prices.js`, `tools/`, `.github/workflows/prices.yml` | Prices without AI. Tickers to fetch: `prices.config.json` plus every paper in the data (`withDataTickers` in `tools/fetch-prices.mjs`, on the server) |
| `boot.js` | Connects screens to sync |
| `sw.js` | Offline copy of the app on each device |
| `server/` | The sync service. `README.md` (install), `API.md` (data contract) |
| `tests/` | Node tests |

`legacy.js` is plain old-style JavaScript (`var`, string-built HTML). Keep that style inside it.
Always pass user text through `esc()` when building HTML.

## Changing a screen: the steps
1. `cd ~/dashboard && git pull`
2. Make the change. Keep it small.
3. **Bump `VERSION` in `sw.js`** (`dash-app-v21` -> `dash-app-v22`). Without this, phones keep showing the old screens.
   If you added a new file the app loads, add it to `FILES` there too.
4. If you changed logic (not only layout), add or update a test in `tests/`.
5. `node --test tests/*.test.js` -> must show `fail 0`.
6. `git add -A && git commit -m "..." && git push`
7. GitHub Pages publishes within a few minutes. Tell Shahar to close and reopen the app (twice if needed).
8. If you changed anything under `server/`: `systemctl --user restart dashboard-sync`, then
   `curl -s http://127.0.0.1:8787/v1/health`.

## If something breaks after a push
- `git revert <commit> && git push` (and bump `VERSION` in `sw.js` again). Do not try to patch forward under pressure.
- Data damaged: `GET /v1/history/<area>` keeps the last 30 writes. Show Shahar the old and the new before restoring.

## Checking your work without a phone
- Logic: the tests.
- A screen: `legacy.js` cannot be opened without a browser. If you have one, serve the folder
  (`npx serve .` or `python3 -m http.server`) and look. If not, say so to Shahar and ask him for a screenshot after the push.
