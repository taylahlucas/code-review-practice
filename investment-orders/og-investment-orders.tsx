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

  private listeners: PriceListener[] = [];

  connect() {
    this.socket = new WebSocket("wss://stream.trading.example.com/prices");

    this.socket.onmessage = (event) => {
      const update: PriceUpdate = JSON.parse(event.data);

      this.listeners.forEach((listener) => {
        listener(update);
      });
    };
  }

  subscribe(listener: PriceListener) {
    this.listeners.push(listener);

    return () => {
      this.listeners.filter((item) => item !== listener);
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

  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(
    null,
  );

  const [error, setError] = useState("");

  // ------------------------------------------
  // Load portfolio and orders
  // ------------------------------------------

  useEffect(() => {
    getPortfolio(userId).then((data) => {
      setPortfolio(data);
    });

    getOrders(userId).then((data) => {
      setOrders(data);
    });
  }, [userId]);

  // ------------------------------------------
  // Subscribe to live prices
  // ------------------------------------------

  useEffect(() => {
    priceFeed.connect();

    priceFeed.subscribe((update) => {
      if (update.symbol === symbol) {
        setPrice(update.price);
      }
    });

    return () => {
      priceFeed.disconnect();
    };
  }, [symbol]);

  // ------------------------------------------
  // Order calculations
  // ------------------------------------------

  const estimatedCost = useMemo(() => {
    return price * quantity;
  }, [price]);

  // ------------------------------------------
  // Place order
  // ------------------------------------------

  async function handleBuy() {
    setLoading(true);
    setError("");

    try {
      if (portfolio && portfolio.availableBalance < estimatedCost) {
        setError("Insufficient funds");
        return;
      }

      const order = await placeOrder(userId, symbol, quantity);

      setOrders([order, ...orders]);

      setPortfolio({
        ...portfolio!,
        availableBalance: portfolio!.availableBalance - estimatedCost,
      });
    } catch {
      setError("Unable to place order");
    }

    setLoading(false);
  }

  // ------------------------------------------
  // Cancel order
  // ------------------------------------------

  async function handleCancel(orderId: string) {
    setCancellingOrderId(orderId);

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
    }

    setCancellingOrderId(null);
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

        <p>Available balance: £{portfolio?.availableBalance.toFixed(2)}</p>
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

            <span>£{order.price.toFixed(2)}</span>

            <span>{order.status}</span>

            {order.status === "PENDING" && (
              <button
                onClick={() => handleCancel(order.id)}
                disabled={cancellingOrderId === order.id}
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
