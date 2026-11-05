import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import "@/theme/orchid.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// A two-finger scroll over a focused number field changes its value in Chrome. Release focus first so the
// page scrolls instead (and nothing gets saved by accident).
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
}, { passive: true });
