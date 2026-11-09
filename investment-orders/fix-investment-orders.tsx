import { useEffect, useState, useMemo } from "react";

// ------------------------------------------
// Types
// ------------------------------------------

type OrderStatus = "PENDING" | "FILLED" | "REJECTED" | "CANCELLED";

interface Order {
  id: string;
  symbol: string;
  quantity: number;
  price: number;
  status: OrderStatus;
  createdAt: string;
}

interface Portfolio {
  availableBalance: number;
  positions: Record<string, number>;
}

interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

interface TradingScreenProps {
  userId: string;
  symbol: string;
}

// ------------------------------------------
// API
// ------------------------------------------

const API_URL = "https://api.trading.example.com";

function assetOk(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

async function getPortfolio(userId: string): Promise<Portfolio> {
  const response = await fetch(`${API_URL}/portfolio/${userId}`);

  assetOk(response);

  return response.json();
}

async function getOrders(userId: string): Promise<Order[]> {
  const response = await fetch(`${API_URL}/orders?userId=${userId}`);

  assetOk(response);

  return response.json();
}

async function placeOrder(
  userId: string,
  symbol: string,
  quantity: number,
): Promise<Order> {
  const response = await fetch(`${API_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      symbol,
      quantity,
      side: "BUY",
    }),
  });

  assetOk(response);

  return response.json();
}

async function cancelOrder(orderId: string): Promise<void> {
  const response = await fetch(`${API_URL}/orders/${orderId}`, {
    method: "DELETE",
  });

  assetOk(response);
}

// ------------------------------------------
// Price feed
// ------------------------------------------

type PriceListener = (update: PriceUpdate) => void;

class PriceFeed {
  // The open connection. Null means there is nothing to close.
  private socket: WebSocket | null = null;
  // Each function here is called with every valid price update.
  private listeners: PriceListener[] = [];
  // True while the screen wants prices. Disconnect sets this false so a close does not reconnect.
  private shouldReconnect = false;

  // Ask for a connection, and allow a later drop to reconnect.
  connect() {
    this.shouldReconnect = true;
    this.open();
  }

  // Replace any current socket with a new one.
  private open() {
    if (this.socket) {
      // Drop the old close handler so closing it below does not open another socket.
      this.socket.onclose = null;
      // Close the previous connection. Replacing this.socket alone would leave it open.
      this.socket.close();
    }

    // Keep a local reference so this socket can tell itself apart from a newer one.
    const socket = new WebSocket("wss://stream.trading.example.com/prices");
    // Save it so disconnect, and the next open, can close this exact connection.
    this.socket = socket;

    // Run this for each message the server sends.
    socket.onmessage = (event) => {
      try {
        // event.data is text. Parse it into a symbol, price, and timestamp.
        const update: PriceUpdate = JSON.parse(event.data);

        // Ignore a message that parsed but does not have a symbol and a numeric price.
        if (
          typeof update.symbol !== "string" ||
          typeof update.price !== "number"
        ) {
          return;
        }

        // Pass this update to every subscriber.
        this.listeners.forEach((listener) => {
          listener(update);
        });
      } catch {
        // JSON.parse throws on bad text. Catch it so the next message is still handled.
      }
    };

    // Run this when the connection closes, including a network drop.
    socket.onclose = () => {
      // Stop if a newer socket replaced this one, or the screen closed it on purpose.
      if (this.socket !== socket || !this.shouldReconnect) {
        return;
      }

      // This socket is no longer usable.
      this.socket = null;

      // Wait a second, then reconnect only if the screen still wants prices.
      setTimeout(() => {
        if (this.shouldReconnect) {
          this.open();
        }
      }, 1000);
    };
  }

  // Remember a function and return a way to remove that function later.
  subscribe(listener: PriceListener) {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  // Close the feed for good. The following onclose must not reconnect.
  disconnect() {
    this.shouldReconnect = false;
    this.socket?.close();
    // Drop the reference so a late onclose sees that this socket is no longer current.
    this.socket = null;
  }
}

const priceFeed = new PriceFeed();

// ------------------------------------------
// Trading screen
// ------------------------------------------

export function TradingScreen({ userId, symbol }: TradingScreenProps) {
  const [price, setPrice] = useState(0);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  // FIX: Keep user quantity typed seperate to the number willing to trade
  const [quantityInput, setQuantityInput] = useState("1");
  const quantity = Number(quantityInput);
  const hasValidQuantity = Number.isInteger(quantity) && quantity > 0;
  const estimatedCost = hasValidQuantity ? price * quantity : 0;

  const [loading, setLoading] = useState(false);
  const [cancellingOrderIds, setCancellingOrderIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  // ------------------------------------------
  // Load portfolio and orders
  // ------------------------------------------

  useEffect(() => {
    // FIX: Prevent loading if userId has changed
    let ignore = false;
    setPortfolio(null);
    setOrders([]);
    setError("");

    // ISSUE: getPortfolio and getOrders returns a promise, so these functions should be awaited
    // getPortfolio(userId).then((data) => {
    //   setPortfolio(data);
    // });

    // getOrders(userId).then((data) => {
    //   setOrders(data);
    // });

    // FIX: wrap the asynchronous functions in a function, then call it
    async function loadInitialData() {
      try {
        const [nextPortfolio, nextOrders] = await Promise.all([
          getPortfolio(userId),
          getOrders(userId),
        ]);

        if (ignore) {
          return;
        }

        setPortfolio(nextPortfolio);
        setOrders(nextOrders);
      } catch (error) {
        if (ignore) {
          return;
        }
        setError("Unable to load account");
      }
    }
    loadInitialData();

    return () => {
      // FIX: Sets ignore to true so that a new useEffect will set it back to false, indicating a new userId is being used
      ignore = true;
    };
  }, [userId]);

  // ------------------------------------------
  // Subscribe to live prices
  // ------------------------------------------

  useEffect(() => {
    // FIX: Prevents the price from the previous symbol displaying on the screen
    setPrice(0);

    // Connect to the socket
    priceFeed.connect();

    // Every time the price server sends an update, the function will run once per price mesage.
    // ISSUE: the pricefeed is disconnected, but the subscribe function is never cleaned up.
    // priceFeed.subscribe((update) => {
    //   // Compares the message's symbol with the symbol this screen is showing
    //   if (update.symbol === symbol) {
    //     setPrice(update.price);
    //   }
    // });

    // FIX: Assign the subscribe function to an unsubscribe function and call it in the cleanup.
    const unsubscribe = priceFeed.subscribe((update) => {
      // Compares the message's symbol with the symbol this screen is showing.
      if (update.symbol === symbol) {
        setPrice(update.price);
      }
    });

    return () => {
      // FIX: Call the unsubscribe method here before disconnecting the socket connection.
      unsubscribe();
      priceFeed.disconnect();
    };
  }, [symbol]);

  // ------------------------------------------
  // Order calculations
  // ------------------------------------------

  // ISSUE: This will only update if the price changes, but not the quantity
  // const estimatedCost = useMemo(() => {
  //   return price * quantity;
  // }, [price, quantity]);

  // ------------------------------------------
  // Place order
  // ------------------------------------------

  async function handleBuy() {
    if (!hasValidQuantity) {
      setError("Enter a quantity of at least 1");
    }
    setLoading(true);
    setError("");

    try {
      // FIX: Unwrap the portfolio first then remove the ! from the code below
      if (!portfolio) {
        setError("Could not get portfolio");
        return;
      }
      // ISSUE: remove the portfolio check here, since now we are using it above. This helps to make the errors more accurate
      // if (portfolio && portfolio.availableBalance < estimatedCost) {
      if (portfolio.availableBalance < estimatedCost) {
        setError("Insufficient funds");
        return;
      }

      const order = await placeOrder(userId, symbol, quantity);
      // Calculate the cost
      const cost = order.price * order.quantity;

      setOrders((currentOrders) => [order, ...currentOrders]);

      // ISSUE: Should not use direct null check ! here as it can throw errors
      // setPortfolio({
      //   ...portfolio!,
      //   availableBalance: portfolio!.availableBalance - estimatedCost,
      // });

      setPortfolio((currentPortfolio) => {
        if (!currentPortfolio || typeof order.price !== "number") {
          return currentPortfolio;
        }
        // Determine how much the portfolio holds
        const held = currentPortfolio.positions[order.symbol] ?? 0;

        return {
          ...currentPortfolio,
          // FIX: Ensure the balance of the portfolio is updated
          availableBalance: portfolio.availableBalance - cost,
          positions: {
            ...currentPortfolio.positions,
            // FIX: Ensure the quantity of the order is updated
            [order.symbol]: held + order.quantity,
          },
        };
      });
    } catch {
      setError("Unable to place order");
    } finally {
      setLoading(false);
    }
  }

  // ------------------------------------------
  // Cancel order
  // ------------------------------------------

  async function handleCancel(orderId: string) {
    // ISSUE: Multiple orders can be made at once, and this only sets once cancelled order id. this should be updated to accept an array
    // setCancellingOrderId(orderId);

    // FIX: We should set the array with the new orderId
    setCancellingOrderIds((currentIds) =>
      currentIds.includes(orderId) ? currentIds : [...currentIds, orderId],
    );

    try {
      await cancelOrder(orderId);

      // FIX: Find the order to be cancelled from the list of current orders
      const orderToCancel = orders.find((order) => order.id === orderId);
      // FIX: Calculate the cost of the current order to cancel by quantity
      const cost =
        orderToCancel && typeof orderToCancel.price === "number"
          ? orderToCancel.price * orderToCancel.quantity
          : 0;

      // FIX: Update from the current list so this cancel does not overwrite a newer order.
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId ? { ...order, status: "CANCELLED" } : order,
        ),
      );

      // FIX: Update the portfolio with the cancelled cost
      setPortfolio((currentPortfolio) => {
        if (!currentPortfolio || !orderToCancel) {
          return currentPortfolio;
        }

        const held = currentPortfolio.positions[orderToCancel.symbol] ?? 0;

        return {
          ...currentPortfolio,
          // FIX: Update the portfolio with the new cost and position quantity
          availableBalance: currentPortfolio.availableBalance + cost,
          positions: {
            ...currentPortfolio.positions,
            [orderToCancel.symbol]: held - orderToCancel.quantity,
          },
        };
      });
    } catch {
      setError("Unable to cancel order");
    } finally {
      // ISSUE: Since updating to an array, we now need to remove the orderId from an array
      // setCancellingOrderIds(null);

      // FIX: Filter out the current orderId that has been completed and set the state again
      setCancellingOrderIds((currentIds) =>
        currentIds.filter((existingId) => existingId !== orderId),
      );
    }
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------

  return (
    <div className="trading-screen">
      <header>
        <h1>{symbol}</h1>

        <h2>£{price.toFixed(2)}</h2>
      </header>

      <section>
        <h3>Portfolio</h3>

        {/* ISSUE: Called toFixed will crash if availableBalance does not exist . */}
        {/* <p>Available balance: £{portfolio?.availableBalance.toFixed(2)}</p> */}
        {/* FIX: Check the available balance is valid first, otherwise return 0 */}
        <p>
          Available balance: £
          {typeof portfolio?.availableBalance === "number"
            ? portfolio.availableBalance.toFixed(2)
            : "-"}
        </p>
      </section>

      <section>
        <h3>Buy {symbol}</h3>

        <input
          type="number"
          value={quantity}
          onChange={(event) => {
            setQuantityInput(event.target.value);
          }}
        />

        <p>
          Estimated cost: £{hasValidQuantity ? estimatedCost.toFixed(2) : "-"}
        </p>

        <button onClick={handleBuy} disabled={loading || !hasValidQuantity}>
          {loading ? "Processing..." : "Buy"}
        </button>

        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h3>Recent orders</h3>

        {orders.map((order) => (
          <div key={order.id}>
            <span>{order.symbol}</span>

            <span>{order.quantity}</span>

            {/* ISSUE: Called toFixed will crash if price is not defined. */}
            {/* <span>£{order.price.toFixed(2)}</span> */}
            {/* FIX: Check the order price is valid first, otherwise return 0 */}
            <span>
              £{typeof order.price === "number" ? order.price.toFixed(2) : "-"}
            </span>

            <span>{order.status}</span>

            {order.status === "PENDING" && (
              <button
                onClick={() => handleCancel(order.id)}
                // ISSUE: Now we are dealing with an array so this is not valid
                // disabled={cancellingOrderId === order.id}
                // FIX: We should check if the array includes the order id
                disabled={cancellingOrderIds.includes(order.id)}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
