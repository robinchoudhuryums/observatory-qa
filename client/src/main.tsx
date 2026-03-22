import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initErrorReporting } from "./lib/error-reporting";
import App from "./App";
import "./index.css";

// Initialize Sentry before rendering (requires VITE_SENTRY_DSN env var)
initErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
