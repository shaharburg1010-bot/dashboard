# Updating the dashboard from the server (Claude or any script)

The phone app and anything running on the server share one store: the `dashboard-sync` service on this server
(`http://127.0.0.1:8787`). The app shows only what it finds in the exact places listed below.
A number saved anywhere else is stored, but never appears on the screen.

## Rules
1. **Never write the `dash_*` tables directly.** Use the HTTP calls below.
2. **Never rebuild a block from scratch.** A block (e.g. `finance.shortMedium`) is one stored value.
   Writing a new object over it deletes everything you left out. The service now refuses that.
3. **Change single values with `POST /v1/set`.** Everything around the value stays as it was.
4. **Do not write prices or computed totals.** The app updates `price`, `changePct`, `valueIls`,
   `valueUsd`, `gainPct`, `pct`, `totalIls`, `totalUsd`, `securities`, `fxUsdIls` by itself every 15 minutes.
   Scripts update quantities (`shares`, `units`), cash, fund balances, the plan, and text.
5. After a change, read it back (`GET /v1/sections/finance`) and check it is there.

## Calls
```
# read an area: tasks | debts | finance | leisure | spending | diet
curl -s http://127.0.0.1:8787/v1/sections/finance

# change one or more inner values
curl -s -X POST http://127.0.0.1:8787/v1/set -H 'Content-Type: application/json' -d '{
  "by": "claude",
  "sets": [
    {"path": "finance.shortMedium.ibkr.cashUsd", "value": 250},
    {"path": "finance.shortMedium.ibkr.holdings.0.shares", "value": 5},
    {"path": "finance.shortTerm.total", "value": 2181}
  ]}'

# earlier copies of an area (last 30 writes), to inspect or restore from
curl -s http://127.0.0.1:8787/v1/history/finance
curl -s http://127.0.0.1:8787/v1/history/finance/<version>
```
- A number in the path is a position in a list (`holdings.0`). Position = list length appends an item.
- Replacing a whole block on purpose: add `"replace": true` to that set. Use it only to restore a block
  from history, or when Shahar asked for the block to be rebuilt.
- List items (tasks, debts, workouts, diet log) go through `POST /v1/ops`, as described in `README.md`.
- All calls in one request succeed together or fail together. A `400` reply says what was wrong.

## Where the finance page reads from
| On screen | Read from |
|---|---|
| Short range | `finance.shortTerm.total`, and the list under it from `finance.shortTerm.items[]` (`label`, `sid`, `units`, `value`, optional `gainPct`) |
| Medium range (all securities at the bank) | `finance.shortMedium.bank.securities` + `finance.shortMedium.ibkr.totalIls` + `ibkr.cashUsd` × `ibkr.fxUsdIls` |
| Long range | `finance.longTerm.pension.value` + `finance.longTerm.menorahGemel.value` + `finance.shortMedium.studyFund.value` + `finance.shortMedium.analystGemel.value` |
| Total investments | short + medium + long |
| Holdings table, Israel | `finance.shortMedium.bank.securitiesBreakdown[]`: `label`, `units`, `price`, `value`, `gainPct`, `changePct`, `sid` |
| Holdings table, abroad | `finance.shortMedium.ibkr.holdings[]`: `ticker`, `name`, `shares`, `price`, `valueUsd`, `valueIls`, `gainPct`, `changePct` |
| Real estate | `finance.realEstate`: `currentEstLow`, `currentEstHigh`, `mortgage`, `purchaseDate`, `monthlyNet`, `oneTimeCosts` |
| Loan | `finance.loan.amount` |
| Plan | `finance.plan`: `theme`, `investments.items[]` (`ticker`, `status`, `entryZone`, `cancelBelow`, `sellPrice`, `suggestedSizeUsd`), `investments.note`, `pendingOrders[]` (`item`, `side`, `units`, `valueIls`, `status`), `medium` (`monthly`, `slots`, `rule`, optional `targets[]`), `shortChannel` (`monthly`, `target`), `asOf` |
| Spending | `finance.spending` (its own area: `spending`) |

Notes:
- The key `ibkr` is a historical name. It holds the foreign securities kept at the bank (there is no IBKR account). Do not rename it, and do not add keys such as `short` or `medium` inside `finance.shortMedium`: the page does not read them.
- The study fund and the Analyst gemel sit inside `finance.shortMedium` but count as long range.
- Page order: total, short range, medium range, plan, long range, real estate, spending, insurance.

A new holding needs at least `ticker`, `name`, `shares`, plus a first `price`, `valueIls` and `gainPct`
taken from the broker, so the app can work out its cost. After that the app keeps it up to date.

Keys the page does not read (for example `finance.candidates`) are kept but not shown.
Showing something new needs a change in the app code, not only in the data.

## The investment portfolio comes from a file (since 20.11.2026)
Holdings abroad (`ibkr.holdings` quantities and costs), the bank funds (`bank.securitiesBreakdown` units),
`finance.shortTerm`, `ibkr.cashUsd` and the whole `finance.plan` are copied by the app from the
`json portfolio` block at the end of `תיק השקעות.md` in the finance folder in Drive (see `portfolio.js`).
Change them there, not here: a change made here is overwritten the next time the file's block changes.
Prices and values are still the app's job.
