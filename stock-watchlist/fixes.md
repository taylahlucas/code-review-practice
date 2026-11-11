# Fixes in the stock watchlist

`og-stock-watchlist.tsx` is the original screen. `fix-stock-watchlist.tsx` is the same screen with the bugs below addressed.

## Loading the watchlist

**The loading flag.** The original effect called `setLoading(true)`, started the request, then called `setLoading(false)` on the next line. That second call runs immediately, before the request finishes, so the loading message disappeared while the watchlist was still in flight.

`setLoading(false)` now runs in `finally`, after the request succeeds or fails. `loading` still starts as `false`, so the first paint is an empty watchlist until the effect sets it to `true`.

**Which user is loaded.** The original dependency list was empty, and the effect read `userId` from the first render. Changing the user left the previous watchlist on screen.

`userId` is now a dependency. When it changes, the effect clears the stocks, the load error, and the action error, then loads that user's list.

**A slow response.** The original `.then` always called `setStocks`. Switch from user A to user B, and if A's response arrived last, the screen showed A's stocks.

Each load has its own `ignore` flag, starting as `false`. The checks sit after `await fetchWatchlistData(...)`. Changing `userId`, or leaving the page, runs the cleanup and sets that load's flag to `true`. A's response then returns without saving. The `catch` and `finally` blocks check the flag too, so A cannot set an error or turn off B's loading state. B has its own flag, still `false`, so B's response is saved.

**A failed HTTP status.** `fetch` only throws when the network fails. A 404 or 500 still produces a response. The original code passed that body to `response.json()` and stored it as the watchlist.

`assertOk` throws when `response.ok` is false. `fetchWatchlistData` awaits it before reading the body. The existing `catch` then shows "Failed to load watchlist".

**A successful response with the wrong shape.** A 200 whose body was not a list of stocks was stored anyway. The next render called `stock.price.toFixed` and `stock.name.toLowerCase`. That throw happens during render, outside the load `try/catch`, so the error message never appeared.

`fetchWatchlistData` reads the body as `unknown` and runs it through `isWatchlist`. That check requires an array whose items each have a numeric `id`, a symbol, a name, and numeric `price` and `previousPrice`. A body that fails the check throws. The throw is inside the load `try`, so the screen shows "Failed to load watchlist" and the bad body is never stored. `unknown` is used because the server's JSON has no guaranteed shape. TypeScript will not treat the value as `Stock[]` until `isWatchlist` returns true.

## Refreshing prices

The original interval called `response.json()` and read `prices[stock.symbol]` with no `try/catch`. A network failure, a 500, or a body that was not a price map rejected the interval callback, and nothing displayed that failure. A body with the wrong shape was also used as the price map. Indexing that value with a symbol is what produced "Element implicitly has an 'any' type because index expression is not of type 'number'" when the value was typed as an array.

`fetchStockPrices` awaits `assertOk`, reads the body as `unknown`, and checks it with `isPriceMap`. The check requires a plain object whose values are all numbers, keyed by symbol. The result type is `Record<string, number>`, so `prices[stock.symbol]` is a number. The interval wraps the call in `try/catch`.

The lookup used `||`. A real quote of `0` is falsy, so it was replaced by the stock's current price. The update now uses `??`, which falls back only when that symbol is missing.

The `catch` calls `setError`. That is the same state that replaces the whole page, and a later successful poll does not clear it. A failed refresh hides the watchlist until `userId` changes.

## Search and sort

**Search.** The filter checked `stock.name` only, and `useMemo` listed only `stocks`. Typing a ticker found nothing when the company name was different, and changing the text did not rerun the filter until the stock list itself changed. The filter now keeps a stock when either the name or the symbol contains the query, and both `stocks` and `search` are dependencies.

**Sort.** The sorted list depended only on `filteredStocks`. Changing the dropdown updated `sortBy` and left the rows in the previous order until the filtered list changed. `sortBy` is now a dependency. An equal price used to fall through to "Price decreased". The row now says "No change" when the price and the previous price are equal.

## Removing a stock

The original `removeStock` had no `try/catch` and did not check `response.ok`. The local list was then filtered with `stocks` from the click. A failed delete still removed the row, and a list updated while the request was in flight could be overwritten by that older array.

`removeStockData` awaits `assertOk` before the screen changes. The stock is removed only after that succeeds. `setStocks` receives the current list from React and filters that list. A failure sets `actionError` and leaves the row in place. `finally` clears `isOperationInProgress`, and the Remove button is disabled while that flag is true, so a second click does not start another delete.

## Adding a stock

The original file defined `addStock` and never rendered a button that called it. There was no way to add a stock, including the first one on an empty list. The request also stored `response.json()` without checking the status or the shape, and it appended to the `stocks` array captured by the click.

The screen now has an Add button beside the search field. It sends the text in that field, so an empty watchlist can still add a stock. The same field filters the list, so Add submits whatever is typed there, including a partial name. `addStockData` awaits `assertOk`. On success, `setStocks` receives the current list and appends the new stock. A failure sets `actionError` and does not change the list. `finally` clears the in-progress flag, and Add is disabled while it is set.

The new stock is passed through `isStock` before it is saved. `response.json()` is not awaited, so `data` is a `Promise`. `isStock` rejects that promise, and the add ends in the `catch` before the list updates.

## Action errors

Add and remove used to share `error` with a failed load. The render returns that message instead of the watchlist, and nothing cleared it, so one failed button left the list unreachable.

Add and remove now write `actionError`. The watchlist stays on screen, and the message is rendered above the search field. A new add, a new remove, or a change of `userId` clears it. A failed load still uses `error` and replaces the page, because there is no list to show.
