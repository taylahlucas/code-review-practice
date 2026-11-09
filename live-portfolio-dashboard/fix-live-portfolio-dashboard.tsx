import { useEffect, useState, useMemo } from "react";

// ------------------------------------------
// Types
// ------------------------------------------

interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
}

interface Portfolio {
  id: string;
  name: string;
  holdings: Holding[];
}

interface PriceUpdate {
  symbol: string;
  price: number;
}

interface PortfolioDashboardProps {
  portfolioId: string;
}

// ------------------------------------------
// API
// ------------------------------------------

const API_URL = "https://api.trading.example.com";

// Wrapper for endpoints to handle HTML errors
async function assertOk(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}`);
  }
}

function isHolding(value: unknown): value is Holding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const holding = value as Record<string, unknown>;

  return (
    typeof holding.symbol === "string" &&
    typeof holding.name === "string" &&
    typeof holding.quantity === "number" &&
    typeof holding.averagePrice === "number" &&
    typeof holding.currentPrice === "number"
  );
}

// We cast as unknown since typescript will not allow you to treat it as "Portfolio" until the shape is proven. Any turns that check off, meaning an incorrect schema would still compile even though it would fail later on.
function isPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const portfolio = value as Record<string, unknown>;

  return (
    typeof portfolio.id === "string" &&
    typeof portfolio.name === "string" &&
    Array.isArray(portfolio.holdings) &&
    portfolio.holdings.every(isHolding)
  );
}

async function fetchPortfolio(portfolioId: string): Promise<Portfolio> {
  // We should use encodeURIComponent here to keep the id as one path segment
  const response = await fetch(
    `${API_URL}/portfolios/${encodeURIComponent(portfolioId)}`,
  );

  assertOk(response);

  const data: unknown = await response.json();

  // Checking the portfolio data is what we expect
  if (!isPortfolio(data)) {
    throw new Error("Unexpected portfolio response");
  }

  return data;
}

// ------------------------------------------
// Price subscription
// ------------------------------------------

class MarketDataService {
  private socket: WebSocket | null = null;
  private listeners: Function[] = [];
  // Add a reconnect timer to ensure we can connect to the socket again after a drop
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = 0;

  connect() {
    this.subscribers += 1;

    if (this.socket) {
      return;
    }

    this.open();
  }

  private open() {
    // Check if the current socket is open first, if so, close it
    if (this.socket) {
      // Dropping the onclose handle so calling it doesn't open a new socket
      this.socket.onclose = null;
      // Close any previous connection
      this.socket.close();
    }

    const socket = new WebSocket("wss://stream.trading.example.com/prices");
    this.socket = socket;

    // Update listeners on message, ensuring event.data is parsed first
    socket.onmessage = (event) => {
      // Wrap in try catch so a bad JSON.parse doesn't crash
      try {
        const update: PriceUpdate = JSON.parse(event.data);

        // Check if the update data is valid first
        if (
          typeof update.price !== "number" ||
          typeof update.symbol !== "string"
        ) {
          return;
        }

        this.listeners.forEach((listener) => {
          listener(update);
        });
      } catch {
        // Fall through bad JSON parsing
      }
    };

    socket.onclose = () => {
      // Check if the current socket is this socket before closing
      if (this.socket !== socket) {
        return;
      }

      // Ensure this socket is no longer used
      this.socket = null;

      // Reconnect the socket after closing
      this.reconnectTimer = setTimeout(() => {
        // onclose waits one second then calls open(), open() closes whatever socket is current and opens a new one. If a second dashboard mounts in that second, connect() sees no socket and opens one immediately. We should clear the timer at the start of open() and skip the retry when nothing is listening.
        this.reconnectTimer = null;

        if (this.subscribers === 0) {
          return;
        }
        this.open();
      }, 1000);
    };
  }

  subscribe(listener: Function) {
    this.listeners.push(listener);

    return () => {
      // Ensure the existing listeners is actually updated
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  disconnect() {
    this.subscribers -= 1;

    if (this.subscribers > 0) {
      return;
    }

    // Cancels any retry that is already waiting
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    // Drop the reference so a late onclose knows that this socket is no longer current
    this.socket = null;
  }
}

const marketData = new MarketDataService();

// ------------------------------------------
// Portfolio dashboard
// ------------------------------------------

export function PortfolioDashboard({ portfolioId }: PortfolioDashboardProps) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("value");
  // Loading should start as true while the initial portfolio is loading.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ----------------------------------------
  // Fetch portfolio
  // ----------------------------------------

  useEffect(() => {
    let ignore = false;
    // Ensure state is reset on new use effect, so we don't retrieve a previous users data
    setPortfolio(null);
    setSearch("");
    setError("");
    setLoading(true);

    const loadInitialData = async () => {
      try {
        const response = await fetchPortfolio(portfolioId);

        // The ignore needs to be after we fetch the portfolio, so if we receive a response for portfolio A which arrives after you switch to portfolio B, it will be ignored.
        if (ignore) return;

        setPortfolio(response);
        // Only update prices that have changed, rather than remapping the whole set
        setPrices((previous) => {
          const next: Record<string, number> = {};

          for (const holding of response.holdings) {
            next[holding.symbol] =
              previous[holding.symbol] ?? holding.currentPrice;
          }

          return next;
        });
      } catch {
        if (!ignore) setError("Unable to load portfolio");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadInitialData();

    // When portfolioId changes, this runs and ignore is set to true
    return () => {
      ignore = true;
    };
  }, [portfolioId]);

  // ----------------------------------------
  // Subscribe to market data
  // ----------------------------------------

  useEffect(() => {
    marketData.connect();

    // Need to make sure we unsubscribe this listener aswell
    const unsubscribe = marketData.subscribe((update: PriceUpdate) => {
      setPrices((previous) => {
        // Skip symbols we don't hold. Returning the same object avoids a re-render.
        if (!(update.symbol in previous)) {
          return previous;
        }

        return {
          ...previous,
          [update.symbol]: update.price,
        };
      });
    });

    return () => {
      unsubscribe();
      marketData.disconnect();
    };
  }, []);

  // ----------------------------------------
  // Calculate portfolio value
  // ----------------------------------------

  const totalValue = useMemo(() => {
    if (!portfolio) return 0;

    return portfolio.holdings.reduce((total, holding) => {
      // Need to use ?? here instead of || , since || will fail for 0
      const currentPrice = prices[holding.symbol] ?? holding.currentPrice;

      return total + currentPrice * holding.quantity;
    }, 0);
    // Since prices is also read, we should depend on that too
  }, [portfolio, prices]);

  // ----------------------------------------
  // Calculate profit/loss
  // ----------------------------------------

  const totalProfitLoss = useMemo(() => {
    if (!portfolio) return 0;

    return portfolio.holdings.reduce((total, holding) => {
      const currentPrice = prices[holding.symbol] ?? holding.currentPrice;

      const profit = (currentPrice - holding.averagePrice) * holding.quantity;

      return total + profit;
    }, 0);
  }, [portfolio, prices]);

  // ----------------------------------------
  // Filter holdings
  // ----------------------------------------

  const filteredHoldings = useMemo(() => {
    if (!portfolio) return [];
    const query = search.toLowerCase();

    return portfolio.holdings.filter(
      (holding) =>
        holding.name.toLowerCase().includes(query) ||
        holding.symbol.toLowerCase().includes(query),
    );
  }, [portfolio, search]);

  // ----------------------------------------
  // Sort holdings
  // ----------------------------------------

  const sortedHoldings = useMemo(() => {
    const priceOf = (holding: Holding) =>
      prices[holding.symbol] ?? holding.currentPrice;

    return [...filteredHoldings].sort((a, b) => {
      if (sortBy === "value") {
        return priceOf(b) * b.quantity - priceOf(a) * a.quantity;
      }

      if (sortBy === "profit") {
        const profit = (holding: Holding) =>
          (priceOf(holding) - holding.averagePrice) * holding.quantity;

        return profit(b) - profit(a);
      }

      return 0;
    });
    // Need to depend on prices here too
  }, [filteredHoldings, sortBy, prices]);

  // ----------------------------------------
  // Render
  // ----------------------------------------

  if (loading) {
    return <p>Loading portfolio...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  if (!portfolio) {
    return <p>No portfolio found</p>;
  }

  return (
    <div>
      <h1>{portfolio.name}</h1>

      <section>
        <h2>Total value: £{totalValue.toFixed(2)}</h2>

        <h3>Profit / Loss: £{totalProfitLoss.toFixed(2)}</h3>
      </section>

      <section>
        <input
          placeholder="Search holdings..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
        >
          <option value="value">Highest value</option>
          <option value="profit">Highest profit</option>
        </select>
      </section>

      <section>
        {sortedHoldings.map((holding) => {
          const currentPrice = prices[holding.symbol] ?? holding.currentPrice;

          const profit =
            (currentPrice - holding.averagePrice) * holding.quantity;

          return (
            <div key={holding.symbol}>
              <h3>{holding.name}</h3>

              <p>{holding.symbol}</p>

              <p>Current price: £{currentPrice.toFixed(2)}</p>

              <p>Quantity: {holding.quantity}</p>

              <p>Value: £{(currentPrice * holding.quantity).toFixed(2)}</p>

              <p>Profit / Loss: £{profit.toFixed(2)}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
