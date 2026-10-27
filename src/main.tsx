import "@/lib/logger";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { WorkspaceProvider } from "@/providers/workspace"
import App from './App.tsx'

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType("resource").map((entry) => entry.name);
      registration.active?.postMessage({ type: "CACHE_FIRST_VISIT_RESOURCES", urls });
    }).catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
