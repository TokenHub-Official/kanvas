import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { KanvasI18nProvider } from "./i18n/kanvas-i18n-provider.js";
import { queryClient } from "./query-client.js";
import { router } from "./router.js";
import { KanvasThemeProvider } from "./theme/kanvas-theme-provider.js";
import "./styles.css";

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("Kanvas Web root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <KanvasI18nProvider>
      <KanvasThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </KanvasThemeProvider>
    </KanvasI18nProvider>
  </StrictMode>,
);
