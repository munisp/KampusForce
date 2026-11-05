import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { endProviderSession } from "@/lib/oidc";
import { SESSION_EXPIRED_EVENT } from "@/providers/trpc";
import { clearPrivateOfflineSnapshots } from "@/lib/offlineSnapshot";
type SessionUser = {
  id: number;
  phoneE164: string | null;
  email: string | null;
  name: string;
  role: "rep" | "vendor" | "ops" | "finance" | "admin";
  kycState: "unverified" | "pending" | "verified" | "rejected";
};
type Session = { token: string; user: SessionUser };
type WorkspaceContextValue = { token: string; user: SessionUser } & {
  setSession: (session: Session | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const STORAGE_KEY = "kf_sandbox_session";
/** Read once by the sign-in page to say why the person was signed out. */
export const SIGNED_OUT_REASON_KEY = "kf_signed_out_reason";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  });
  // When the server says the session is gone, sign out fully, the same way the Sign out button does: forget the
  // session, end the Keycloak session too (so "Sign in" asks for the password again) and land on the sign-in page.
  const signingOut = useRef(false);
  useEffect(() => {
    const expired = () => {
      if (signingOut.current || !localStorage.getItem(STORAGE_KEY)) return;
      signingOut.current = true;
      clearPrivateOfflineSnapshots();
      localStorage.removeItem(STORAGE_KEY);
      try { sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "expired"); } catch { /* the notice is optional */ }
      // Leave the page as it is until the browser navigates away: clearing the session here would render the
      // sign-in page early, which would use up the notice before Keycloak sends the person back.
      if (!endProviderSession("/")) window.location.assign("/");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);
  const value = useMemo<WorkspaceContextValue>(() => ({
    token: session?.token || "",
    user: session?.user as SessionUser,
    setSession: (next) => {
      if (!next || next.user.id !== session?.user.id) clearPrivateOfflineSnapshots();
      setSessionState(next);
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    },
  }), [session]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
