# Fixes in the live portfolio dashboard

`og-live-portfolio-dashboard.tsx` is the original screen. `fix-live-portfolio-dashboard.tsx` is the same screen with the bugs below addressed.

## Loading a portfolio

**The loading flag.** The original effect called `setLoading(true)`, started the request, then called `setLoading(false)` immediately, before the request finished. The first render also started with `loading` set to `false` and `portfolio` set to `null`, so the screen showed "No portfolio found" and then jumped to the portfolio. The loading message almost never appeared.

`loading` now starts as `true`, so the first paint is "Loading portfolio...". `setLoading(false)` runs in `finally`, after the request succeeds or fails. Changing `portfolioId` sets `loading` back to `true` and clears the previous portfolio, search text, and error before the new request is saved.

**A slow response.** The original `.then` always called `setPortfolio` and `setPrices`. Switch from portfolio A to portfolio B, and if A's response arrived last, the screen showed A.

Each load has its own `ignore` flag, starting as `false`. The check sits after `await fetchPortfolio(...)`. Changing `portfolioId` runs the cleanup and sets that load's flag to `true`. A's response then returns without saving. The `catch` and `finally` blocks check the flag too, so A cannot set an error or turn off B's loading state. B has its own flag, still `false`, so B's response is saved.

**A failed HTTP status.** `fetch` only throws when the network fails. A 404 or 500 still produces a response. The original code passed that body to `response.json()` and treated the result as a portfolio.

`assertOk` throws when `response.ok` is false. `fetchPortfolio` calls it before reading the body. The existing `catch` then shows "Unable to load portfolio".

**A successful response with the wrong shape.** A 200 whose body has no `holdings` array was stored as a portfolio. The next render called `portfolio.holdings.reduce`. That throw happens during render, outside the load `try/catch`, so the error message never appeared.

`fetchPortfolio` reads the body as `unknown` and runs it through `isPortfolio`. That check requires an `id`, a `name`, and a `holdings` array whose items each have a symbol, a name, and numeric quantity and prices. A body that fails the check throws. The throw is inside the load `try`, so the screen shows "Unable to load portfolio" and the bad body is never stored. `unknown` is used because the server's JSON has no guaranteed shape. TypeScript will not treat the value as a `Portfolio` until `isPortfolio` returns true.

**The portfolio id in the URL.** The original request inserted `portfolioId` directly into the path. An id such as `abc/def` or `abc?admin=1` changed the path or added a query string. The id is now passed through `encodeURIComponent`, so it stays one path segment.

## Live prices

**Removing a listener.** `subscribe` used to build a new listener list with `filter` and throw it away, so the old listener stayed registered. It now saves that filtered list. The screen keeps the function `subscribe` returns and calls it in the effect cleanup, before `disconnect()`. Leaving the page removes that dashboard's listener.

**One shared socket.** `marketData` is created once, outside the component, so every dashboard shares it. The original `disconnect` always closed that socket. Unmounting one dashboard froze prices for the others, and their effects did not run again because the dependency list is empty.

`connect` now counts dashboards. It opens a socket only when there is not one already. `disconnect` decreases the count and closes the socket only when the count reaches 0. A second dashboard joins the existing stream. Closing the first leaves the second connected.

**A dropped stream.** The original `onclose` did nothing. After a network drop the page kept the last prices and looked healthy.

A close is ignored when `this.socket` is no longer that socket. `disconnect` sets `this.socket` to `null` before the close event runs, and `open` removes `onclose` before replacing a socket, so an intentional close does not open a new one. A drop, where the closed socket is still the current one, waits one second and calls `open()`. The retry does nothing if the subscriber count is already 0. `disconnect` also cancels a retry that is still waiting, so leaving the page does not reopen the stream.

**Bad messages.** `JSON.parse` used to run with no `try/catch`. A message that was not JSON threw inside `onmessage`. A message is now parsed inside `try/catch`, and it is ignored unless `symbol` is a string and `price` is a number. Later messages still update the screen.

**Prices for symbols you do not hold.** The listener used to write every tick into `prices`. A feed of the whole market grew that object on every message. Each new object recalculated the totals and the sort, even when none of your holdings had changed.

The portfolio load fills `prices` with the symbols you hold. A tick is applied only when that symbol is already in the object. Otherwise the listener returns the same object, and React skips the re-render. The check uses `in`, so a stored price of `0` still counts as a holding.

**Keeping a live price across the load.** The original code replaced `prices` with the snapshot from the response. A tick that arrived while the request was in flight was thrown away. The update now builds a map of the new holdings only. For each symbol it keeps `previous[symbol]` when that entry exists, and otherwise uses `holding.currentPrice`. Symbols from the previous portfolio are left out. `??` is used so a live price of `0` is not replaced by the snapshot.

## Totals, search, and sort

**Total value.** `totalValue` read `prices` but listed only `portfolio` as a dependency. A tick updated the price map and left the heading on the old total until the portfolio object itself changed. `prices` is now a dependency, so each tick recalculates the total.

The price lookup used `||`. A real quote of `0` is falsy, so it was replaced by `holding.currentPrice`. The total, the profit and loss, and each row now use `??`, which falls back only when the live price is missing.

**Search.** The filter checked `holding.name` only. Typing `AAPL` found nothing when the company name was "Apple", even though the row shows the ticker. The filter now keeps a holding when either the name or the symbol contains the query.

**Sort.** Both comparisons used `holding.currentPrice`, the snapshot from the response, and `prices` was not a dependency. After a tick the rows showed the live price while the list stayed in the old order.

The value sort and the profit sort now use the same live price as the rows: `prices[symbol] ?? holding.currentPrice`. The profit comparison used to be the gain per share, `(currentPrice - averagePrice)`, with no quantity. A £1 gain on 10,000 shares sorted below a £2 gain on 1 share. Profit is now `(currentPrice - averagePrice) * quantity`, which matches the profit shown on the row. `prices` is a dependency, so a tick re-sorts the list.

The sort choice starts as `"value"` and is not cleared when a portfolio loads. Clearing it to `""` would match neither dropdown option, and the comparator would return `0` for every pair, leaving the list in the order the API sent.
