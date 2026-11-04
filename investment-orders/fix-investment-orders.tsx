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

async function getPortfolio(userId: string): Promise<Portfolio> {
  const response = await fetch(`${API_URL}/portfolio/${userId}`);

  return response.json();
}

async function getOrders(userId: string): Promise<Order[]> {
  const response = await fetch(`${API_URL}/orders?userId=${userId}`);

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

  return response.json();
}

async function cancelOrder(orderId: string): Promise<void> {
  await fetch(`${API_URL}/orders/${orderId}`, {
    method: "DELETE",
  });
}

// ------------------------------------------
// Price feed
// ------------------------------------------

type PriceListener = (update: PriceUpdate) => void;

class PriceFeed {
  private socket: WebSocket | null = null;

  // List of functions that want to be told about each price.
  private listeners: PriceListener[] = [];

  // Opens the connection, the server sends a message whenever a price changes.
  connect() {
    this.socket = new WebSocket("wss://stream.trading.example.com/prices");

    // onmessage turns a message from text into an object, then calls every function in listeners with it.
    // Each object looks like a symbol, a price and a timestamp.
    this.socket.onmessage = (event) => {
      const update: PriceUpdate = JSON.parse(event.data);

      this.listeners.forEach((listener) => {
        listener(update);
      });
    };
  }

  // Adds one of the listener functions to the list of listeners
  subscribe(listener: PriceListener) {
    this.listeners.push(listener);

    return () => {
      // ISSUE: This does not return a list of filtered items, it builds it and throws it away
      // this.listeners.filter((item) => item !== listener);

      // FIX: Set the listeners to the filtered array
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  disconnect() {
    this.socket?.close();
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
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [cancellingOrderIds, setCancellingOrderIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  // ------------------------------------------
  // Load portfolio and orders
  // ------------------------------------------

  useEffect(() => {
    // ISSUE: getPortfolio and getOrders returns a promise, so these functions should be awaited
    // getPortfolio(userId).then((data) => {
    //   setPortfolio(data);
    // });

    // getOrders(userId).then((data) => {
    //   setOrders(data);
    // });

    // FIX: wrap the asynchronous functions in a function, then call it
    async function loadInitialData() {
      const [portfolio, orders] = await Promise.all([
        getPortfolio(userId),
        getOrders(userId),
      ]);

      setPortfolio(portfolio);
      setOrders(orders);
    }

    loadInitialData();
  }, [userId]);

  // ------------------------------------------
  // Subscribe to live prices
  // ------------------------------------------

  useEffect(() => {
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

  // FIX: Add quantity to the dependency array. useMemo is not necessary here, this calculation is cheap.
  const estimatedCost = price * quantity;

  // ------------------------------------------
  // Place order
  // ------------------------------------------

  async function handleBuy() {
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

      setOrders([order, ...orders]);

      // ISSUE: Should not use direct null check ! here as it can throw errors
      // setPortfolio({
      //   ...portfolio!,
      //   availableBalance: portfolio!.availableBalance - estimatedCost,
      // });

      setPortfolio({
        ...portfolio,
        availableBalance: portfolio.availableBalance - estimatedCost,
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

      const updatedOrders = orders.map((order) => {
        if (order.id === orderId) {
          return {
            ...order,
            status: "CANCELLED" as OrderStatus,
          };
        }

        return order;
      });

      setOrders(updatedOrders);
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
            : "0.00"}
        </p>
      </section>

      <section>
        <h3>Buy {symbol}</h3>

        <input
          type="number"
          value={quantity}
          onChange={(event) => {
            setQuantity(Number(event.target.value));
          }}
        />

        <p>Estimated cost: £{estimatedCost.toFixed(2)}</p>

        <button onClick={handleBuy} disabled={loading}>
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
              £
              {typeof order.price === "number"
                ? order.price.toFixed(2)
                : "0.00"}
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
