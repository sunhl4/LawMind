import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { LawmindErrorBoundary } from "./LawmindErrorBoundary";
import { LawmindReviewPreviewPopout } from "./LawmindReviewPreviewPopout";
import { parseLawmindPopoutRoute } from "./lawmind-popout-route";
import { lawmindQueryClient } from "./lawmind-query-client";
import "./styles.css";

function mountTarget(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing) {
    return existing;
  }
  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  return created;
}

const el = mountTarget();
const popout = parseLawmindPopoutRoute();
createRoot(el).render(
  <StrictMode>
    <LawmindErrorBoundary label="LawMind">
      <QueryClientProvider client={lawmindQueryClient}>
        {popout?.kind === "review-preview" ? (
          <LawmindReviewPreviewPopout taskId={popout.taskId} />
        ) : (
          <App />
        )}
      </QueryClientProvider>
    </LawmindErrorBoundary>
  </StrictMode>,
);
