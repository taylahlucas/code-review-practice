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

async function fetchPortfolio(portfolioId: string): Promise<Portfolio> {
  const response = await fetch(`${API_URL}/portfolios/${portfolioId}`);

  return response.json();
}

// ------------------------------------------
// Price subscription
// ------------------------------------------

class MarketDataService {
  private socket: WebSocket | null = null;

  private listeners: Function[] = [];

  connect() {
    if (this.socket) return;

    this.socket = new WebSocket("wss://stream.trading.example.com/prices");

    this.socket.onmessage = (event) => {
      const update: PriceUpdate = JSON.parse(event.data);

      this.listeners.forEach((listener) => {
        listener(update);
      });
    };
  }

  subscribe(listener: Function) {
    this.listeners.push(listener);

    return () => {
      this.listeners.filter((item) => item !== listener);
    };
  }

  disconnect() {
    this.socket?.close();
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

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  // ----------------------------------------
  // Fetch portfolio
  // ----------------------------------------

  useEffect(() => {
    setLoading(true);

    fetchPortfolio(portfolioId)
      .then((data) => {
        setPortfolio(data);
        setPrices(
          Object.fromEntries(
            data.holdings.map((holding) => [
              holding.symbol,
              holding.currentPrice,
            ]),
          ),
        );
      })
      .catch(() => {
        setError("Unable to load portfolio");
      });

    setLoading(false);
  }, [portfolioId]);

  // ----------------------------------------
  // Subscribe to market data
  // ----------------------------------------

  useEffect(() => {
    marketData.connect();

    marketData.subscribe((update: PriceUpdate) => {
      setPrices((previous) => ({
        ...previous,
        [update.symbol]: update.price,
      }));
    });

    return () => {
      marketData.disconnect();
    };
  }, []);

  // ----------------------------------------
  // Calculate portfolio value
  // ----------------------------------------

  const totalValue = useMemo(() => {
    if (!portfolio) return 0;

    return portfolio.holdings.reduce((total, holding) => {
      const currentPrice = prices[holding.symbol] || holding.currentPrice;

      return total + currentPrice * holding.quantity;
    }, 0);
  }, [portfolio]);

  // ----------------------------------------
  // Calculate profit/loss
  // ----------------------------------------

  const totalProfitLoss = useMemo(() => {
    if (!portfolio) return 0;

    return portfolio.holdings.reduce((total, holding) => {
      const currentPrice = prices[holding.symbol] || holding.currentPrice;

      const profit = (currentPrice - holding.averagePrice) * holding.quantity;

      return total + profit;
    }, 0);
  }, [portfolio, prices]);

  // ----------------------------------------
  // Filter holdings
  // ----------------------------------------

  const filteredHoldings = useMemo(() => {
    if (!portfolio) return [];

    return portfolio.holdings.filter((holding) =>
      holding.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [portfolio, search]);

  // ----------------------------------------
  // Sort holdings
  // ----------------------------------------

  const sortedHoldings = useMemo(() => {
    return [...filteredHoldings].sort((a, b) => {
      if (sortBy === "value") {
        return b.currentPrice * b.quantity - a.currentPrice * a.quantity;
      }

      if (sortBy === "profit") {
        return (
          b.currentPrice - b.averagePrice - (a.currentPrice - a.averagePrice)
        );
      }

      return 0;
    });
  }, [filteredHoldings, sortBy]);

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
          const currentPrice = prices[holding.symbol] || holding.currentPrice;

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
