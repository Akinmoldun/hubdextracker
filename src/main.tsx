import { Toaster } from "@/components/ui/sonner";
import { HubdexWordmark } from "@/components/hubdex";
import { RequireAuth } from "@/components/RequireAuth";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

let cachedConvexClient: ConvexReactClient | null = null;

function getConvexClient(): ConvexReactClient {
  if (cachedConvexClient) {
    return cachedConvexClient;
  }

  const raw = (import.meta.env.VITE_CONVEX_URL ?? "").trim();
  if (!raw) {
    throw new Error(
      "Missing VITE_CONVEX_URL environment variable. Set VITE_CONVEX_URL to your Convex Cloud URL (https://<deployment>.convex.cloud) in your environment settings and redeploy.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `Invalid VITE_CONVEX_URL "${raw}". Expected a full Convex Cloud URL such as https://<deployment>.convex.cloud.`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid VITE_CONVEX_URL protocol "${parsed.protocol}". Expected https://<deployment>.convex.cloud.`,
    );
  }

  if (parsed.hostname.endsWith(".convex.site")) {
    const suggested = `${parsed.protocol}//${parsed.hostname.replace(/\.convex\.site$/, ".convex.cloud")}`;
    throw new Error(
      `VITE_CONVEX_URL is set to the HTTP Actions URL (${parsed.origin}) instead of the Convex Cloud URL. Update VITE_CONVEX_URL to ${suggested}.`,
    );
  }

  cachedConvexClient = new ConvexReactClient(raw.replace(/\/+$/, ""));
  return cachedConvexClient;
}

function ConvexClientRoot({ children }: { children: React.ReactNode }) {
  const client = getConvexClient();
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Hard guard so configuration or runtime errors never leave a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unexpected application error",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Hubdex] Application error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="ibm-grid flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="w-full max-w-lg border border-border bg-background shadow-[8px_8px_0_0_rgba(22,22,22,0.06)]">
            <div className="h-1 w-full bg-primary" />
            <div className="p-8">
              <HubdexWordmark />
              <p className="ibm-eyebrow mt-6 text-[#0f62fe]">
                Configuration required
              </p>
              <h1 className="mt-2 text-xl font-bold tracking-[-0.01em]">
                Unable to connect to Hubdex backend
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground break-words">
                {this.state.message}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ConvexClientRoot>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexClientRoot>
    </RootErrorBoundary>
  </StrictMode>,
);
