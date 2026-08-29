import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { LawmindReviewPreviewPopout } from "./LawmindReviewPreviewPopout";
import { parseLawmindPopoutRoute } from "./lawmind-popout-route";
import { lawmindQueryClient } from "./lawmind-query-client";
import "./styles.css";

const el = document.getElementById("root");
const popout = parseLawmindPopoutRoute();
if (el) {
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={lawmindQueryClient}>
        {popout?.kind === "review-preview" ? (
          <LawmindReviewPreviewPopout taskId={popout.taskId} />
        ) : (
          <App />
        )}
      </QueryClientProvider>
    </StrictMode>,
  );
}
