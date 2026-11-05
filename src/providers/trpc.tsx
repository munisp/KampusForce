import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

export const SESSION_EXPIRED_EVENT = "kf:session-expired";

/** True when the server rejected the session itself (expired or revoked), not a sign-in attempt or a permission. */
export function isSessionExpired(error: unknown) {
  const data = (error as { data?: { code?: string; path?: string } } | null)?.data;
  return data?.code === "UNAUTHORIZED" && !data.path?.startsWith("auth.");
}

// Any request that finds the session gone signs the person out (providers/workspace.tsx listens).
const reportExpiry = (error: unknown) => { if (isSessionExpired(error)) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); };

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportExpiry }),
  mutationCache: new MutationCache({ onError: reportExpiry }),
  // Retrying with a dead session only delays the sign-out.
  defaultOptions: { queries: { retry: (failures, error) => !isSessionExpired(error) && failures < 3 } },
});
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
