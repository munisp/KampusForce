import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { clearPrivateOfflineSnapshots } from "@/lib/offlineSnapshot";
type SessionUser = {
  id: number;
  phoneE164: string;
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  });
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
