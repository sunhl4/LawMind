import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { lawmindQueryClient } from "./lawmind-query-client";
import "./styles.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={lawmindQueryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
