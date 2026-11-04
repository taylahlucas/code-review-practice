import { createRoot } from "react-dom/client";
import { TradingScreen } from "../investment-orders/fix-investment-orders";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(<TradingScreen userId="user-1" symbol="AAPL" />);
