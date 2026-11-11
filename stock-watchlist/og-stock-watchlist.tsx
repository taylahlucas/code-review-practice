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

export function Watchlist({ userId }: WatchlistProps) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("name");

  // Fetch watchlist
  useEffect(() => {
    setLoading(true);

    fetch(`/api/users/${userId}/watchlist`)
      .then((response) => response.json())
      .then((data) => {
        setStocks(data);
      })
      .catch(() => {
        setError("Failed to load watchlist");
      });

    setLoading(false);
  }, []);

  // Automatically refresh stock prices
  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch("/api/stocks/prices");
      const prices = await response.json();

      setStocks((previousStocks) =>
        previousStocks.map((stock) => ({
          ...stock,
          previousPrice: stock.price,
          price: prices[stock.symbol] || stock.price,
        })),
      );
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Search and filter stocks
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) =>
      stock.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [stocks]);

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
  }, [filteredStocks]);

  const removeStock = async (stockId: number) => {
    await fetch(`/api/watchlist/${stockId}`, {
      method: "DELETE",
    });

    setStocks(stocks.filter((stock) => stock.id !== stockId));
  };

  const addStock = async (symbol: string) => {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol }),
    });

    const stock = await response.json();
    setStocks([...stocks, stock]);
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

      <input
        value={search}
        placeholder="Search stocks..."
        onChange={(event) => setSearch(event.target.value)}
      />

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
                : "Price decreased"}
            </p>

            <button onClick={() => removeStock(stock.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
