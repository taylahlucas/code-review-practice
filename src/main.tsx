import { createRoot } from "react-dom/client";
import { TradingScreen } from "../investment-orders/fix-investment-orders";
import { PortfolioDashboard } from "../live-portfolio-dashboard/fix-live-portfolio-dashboard";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

// createRoot(root).render(<TradingScreen userId="user-1" symbol="AAPL" />);
createRoot(root).render(<PortfolioDashboard portfolioId="portfolio-1" />);
