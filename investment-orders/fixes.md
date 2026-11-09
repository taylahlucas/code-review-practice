# Fixes in the trading screen

`og-investment-orders.tsx` is the original screen. `fix-investment-orders.tsx` is the same screen with the bugs below addressed.

## Failed requests are no longer treated as success

`fetch` only throws when the network fails. A 404 or 500 still produces a response.

The original code read that response as normal data. A failed buy could be added to the order list and deducted from the balance. A failed delete could still mark the order `CANCELLED`.

`assetOk` throws when `response.ok` is false. `getPortfolio`, `getOrders`, `placeOrder`, and `cancelOrder` call it before using the response. The existing `try/catch` blocks then show an error instead of updating the account.

## Loading an account

The original screen started the portfolio request and the orders request separately and had no `catch`. A failure left the balance looking like `£0.00`, because a missing portfolio rendered as a blank amount. If `userId` changed before the first request finished, the slower response could overwrite the newer user's data.

The load now waits for both requests with `Promise.all`. A failure sets the error "Unable to load account".

Each load has its own `ignore` flag, starting as `false`. When `userId` changes, React runs the cleanup and sets that flag to `true`. The old request still finishes, sees `ignore`, and returns without saving. Only the request for the current user writes the portfolio and orders. The effect also clears the previous portfolio, orders, and error as soon as the user changes, so the old account does not stay on screen.

While the portfolio is missing, the balance shows `£-` instead of a number. A loaded balance of zero still shows `£0.00`.

## Live prices

**Removing a listener.** `subscribe` used to build a new listener list with `filter` and throw it away, so the old listener stayed forever. It now saves that filtered list. The screen keeps the function `subscribe` returns and calls it before closing the socket, so a listener for the previous symbol is removed.

**Clearing the old price.** Changing symbol closed the socket and subscribed again, but `price` still held the previous symbol's price until a new tick arrived. The effect now sets the price to `0` when the symbol changes. The heading shows `£0.00` until the first tick for the new symbol.

**The socket.** `connect` used to replace `this.socket` without closing the previous connection. One bad message made `JSON.parse` throw, and a dropped connection stayed down.

`open` closes the current socket before creating a new one. It removes that socket's `onclose` first, so the close does not immediately open a second connection. `JSON.parse` sits inside `try/catch`, so bad text is skipped and the next message is still handled. A message that parses but has no symbol string or numeric price is ignored.

`shouldReconnect` records whether the screen still wants prices. A network close waits one second and connects again. `disconnect` sets the flag to `false` first, so an intentional close stays closed.

## Estimated cost

`estimatedCost` was wrapped in `useMemo`, and the dependency list contained only `price`. Changing the quantity left the old cost on screen until the next price tick. Multiplying two numbers is cheap, so the value is now calculated on each render: price times quantity.

The quantity field keeps the typed text separately. The number used for a trade must be a whole number greater than `0`. An empty field, a negative number, or a non-numeric value makes the cost show `£-` and disables Buy. That avoids `£NaN`, and it stops `availableBalance < NaN`, which is never true, from letting the order through.

## Placing a buy

**A missing portfolio.** `portfolio!` does not check anything at runtime. TypeScript deletes it. If the portfolio was null, spreading it crashed. The buy now returns with "Could not get portfolio" before the order is sent.

**The button getting stuck.** `setLoading(false)` sat after the `try` block. Returning from inside `try` skipped that line, so Buy stayed on "Processing...". It now runs in `finally`, which runs on every exit.

**A stale order list.** `setOrders([order, ...orders])` reused the list from the click. A cancel that finished during the buy could be overwritten, or this buy could erase a newer order. The update now receives the current list from React and adds the order to that list.

**Cash and shares.** The original code only subtracted `estimatedCost` from the balance. It never added the shares to `positions`. The buy now uses `order.price * order.quantity` as the cost, subtracts that from the balance, and adds `order.quantity` to `positions` for the order's symbol. The portfolio update is a function, so it starts from the latest portfolio. The share count is read from that latest portfolio. The balance it writes is the balance from the click, minus this order's cost.

## Cancelling an order

**Several cancels at once.** One `cancellingOrderId` could track only one order. Starting a second cancel replaced the first id, and the first request finishing cleared the flag while the second was still running. The screen now keeps an array, `cancellingOrderIds`. An id is added from the current array, and removed from the current array in `finally`, whether the cancel succeeds or fails. A Cancel button is disabled when its id is in that array.

**A stale order list.** The cancel mapped the `orders` array captured when the button was clicked. The update now receives the current list and marks that one order `CANCELLED`, so an order added while the request was in flight is kept.

**Refunding the buy.** A buy had already taken the cash and, after the fix above, added the shares. A successful cancel now adds `order.price * order.quantity` back to the latest balance and subtracts those shares from `positions`.

## Display

`toFixed` throws if it is called on a missing value. The balance and each order price are formatted only when the value is a number. Otherwise the screen shows `-`.
