import React, { useEffect, useMemo, useState } from "react";

interface Stock {
  id: number;
  symbol: string;
  name: string;
  price: number;
  previousPrice: number;
}

interface WatchlistProps {
  userId: string;
}

const assertOk = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
};

const isStock = (value: unknown): value is Stock => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const stock = value as Record<string, unknown>;

  return (
    typeof stock.id === "number" &&
    typeof stock.symbol === "string" &&
    typeof stock.name === "string" &&
    typeof stock.price === "number" &&
    typeof stock.previousPrice === "number"
  );
};

const isWatchlist = (data: unknown): data is Stock[] => {
  return Array.isArray(data) && data.every(isStock);
};

const fetchWatchlistData = async (userId: string) => {
  const response = await fetch(`/api/users/${userId}/watchlist`);

  await assertOk(response);

  const data: unknown = await response.json();

  if (!isWatchlist(data)) {
    throw new Error("Watchlist data is malformed");
  }
  return data;
};

const removeStockData = async (stockId: number) => {
  const response = await fetch(`/api/watchlist/${stockId}`, {
    method: "DELETE",
  });

  await assertOk(response);
};

const addStockData = async (symbol: string) => {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol }),
  });

  await assertOk(response);

  const data: unknown = response.json();

  if (!isStock(data)) {
    throw new Error("Watchlist data is malformed");
  }

  return data;
};

const isPriceMap = (data: unknown): data is Record<string, number> => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const prices = data as Record<string, unknown>;

  return Object.values(prices).every((price) => typeof price === "number");
};

const fetchStockPrices = async () => {
  const response = await fetch("/api/stocks/prices");

  await assertOk(response);

  const data: unknown = await response.json();

  if (!isPriceMap(data)) {
    throw new Error("Stock price data is malformed");
  }

  return data;
};

export function Watchlist({ userId }: WatchlistProps) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOperationInProgress, setIsOperationInProgress] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [sortBy, setSortBy] = useState("name");

  // Fetch watchlist
  useEffect(() => {
    let ignore = false;
    setStocks([]);
    setError("");
    setActionError("");
    setIsOperationInProgress(true);
    setLoading(true);

    const fetchWatchlist = async () => {
      try {
        const response = await fetchWatchlistData(userId);

        if (!ignore) setStocks(response);
      } catch {
        if (!ignore) setError("Failed to load watchlist");
      } finally {
        if (!ignore) {
          setIsOperationInProgress(false);
          setLoading(false);
        }
      }
    };

    fetchWatchlist();

    return () => {
      ignore = true;
    };
  }, [userId]);

  // Automatically refresh stock prices
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const prices = await fetchStockPrices();

        setStocks((previousStocks) =>
          previousStocks.map((stock) => ({
            ...stock,
            previousPrice: stock.price,
            price: prices[stock.symbol] ?? stock.price,
          })),
        );
      } catch {
        setError("Could not fetch prices");
      }
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Search and filter stocks
  const filteredStocks = useMemo(() => {
    const searchText = search.toLowerCase();

    return stocks.filter(
      (stock) =>
        stock.name.toLowerCase().includes(searchText) ||
        stock.symbol.toLowerCase().includes(searchText),
    );
  }, [stocks, search]);

  // Sort stocks
  const sortedStocks = useMemo(() => {
    return [...filteredStocks].sort((a, b) => {
      if (sortBy === "price") {
        return b.price - a.price;
      }

      if (sortBy === "change") {
        return b.price - b.previousPrice - (a.price - a.previousPrice);
      }

      return a.name.localeCompare(b.name);
    });
  }, [filteredStocks, sortBy]);

  const removeStock = async (stockId: number) => {
    setActionError("");
    setIsOperationInProgress(true);
    try {
      await removeStockData(stockId);

      setStocks((previous) => previous.filter((stock) => stock.id !== stockId));
    } catch {
      setActionError(`Could not remove stock data for ${stockId}`);
    } finally {
      setIsOperationInProgress(false);
    }
  };

  const addStock = async (symbol: string) => {
    setActionError("");
    setIsOperationInProgress(true);
    try {
      const stock = await addStockData(symbol);

      setStocks((previous) => [...previous, stock]);
    } catch {
      setActionError(`Could not add stock data for ${symbol}`);
    } finally {
      setIsOperationInProgress(false);
    }
  };

  if (loading) {
    return <p>Loading watchlist...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <div>
      <h1>My Watchlist</h1>

      {actionError && <p>{actionError}</p>}

      <input
        value={search}
        placeholder="Search stocks..."
        onChange={(event) => setSearch(event.target.value)}
      />

      <button
        disabled={isOperationInProgress}
        onClick={async () => {
          await addStock(search);
        }}
      >
        Add
      </button>

      <select
        value={sortBy}
        onChange={(event) => setSortBy(event.target.value)}
      >
        <option value="name">Name</option>
        <option value="price">Price</option>
        <option value="change">Daily change</option>
      </select>

      <div>
        {sortedStocks.map((stock) => (
          <div key={stock.id}>
            <h3>
              {stock.name} ({stock.symbol})
            </h3>

            <p>£{stock.price.toFixed(2)}</p>

            <p>
              {stock.price > stock.previousPrice
                ? "Price increased"
                : stock.price < stock.previousPrice
                  ? "Price decreased"
                  : "No change"}
            </p>

            <button
              disabled={isOperationInProgress}
              onClick={async () => {
                await removeStock(stock.id);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
