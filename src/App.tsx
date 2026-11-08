import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useWorkspace } from "@/providers/workspace";
import { workspacePath } from "@/lib/roles";

const Login = lazy(() => import("@/pages/Login"));
const AuthCallback = lazy(() => import("@/pages/AuthCallback"));
const Signup = lazy(() => import("@/pages/Signup"));
const Vendor = lazy(() => import("@/pages/Vendor"));
const Ops = lazy(() => import("@/pages/Ops"));
const RepSupport = lazy(() => import("@/pages/RepSupport"));
const RepTeam = lazy(() => import("@/pages/RepTeam"));
const RecruitAccept = lazy(() => import("@/pages/RecruitAccept"));
const Sales = lazy(() => import("@/pages/Sales"));
const Architecture = lazy(() => import("@/pages/Architecture"));
const Identity = lazy(() => import("@/pages/Identity"));
const RepOverview = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepOverview })));
const RepCatalog = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepCatalog })));
const RepShare = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepShare })));
const RepAssist = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepAssist })));
const RepRecordSale = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepRecordSale })));
const RepEarnings = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepEarnings })));

type Role = "rep" | "vendor" | "ops" | "finance" | "admin";
const STAFF: Role[] = ["ops", "finance", "admin"];

/** Signed in, and a role that uses this page; anyone else goes to their own home instead of a page that can't load. */
function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { token, user } = useWorkspace();
  if (!token) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={workspacePath(user.role)} replace />;
  return children;
}

export default function App() {
  return <Suspense fallback={<div className="route-loading" role="status">Loading workspace…</div>}><Routes>
    <Route path="/" element={<Login />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/signup" element={<Signup />} />
    <Route path="/recruit/accept" element={<RecruitAccept />} />
    <Route path="/rep" element={<Protected roles={["rep"]}><RepOverview /></Protected>} />
    <Route path="/rep/catalog" element={<Protected roles={["rep"]}><RepCatalog /></Protected>} />
    <Route path="/rep/share" element={<Protected roles={["rep"]}><RepShare /></Protected>} />
    <Route path="/rep/assist" element={<Protected roles={["rep"]}><RepAssist /></Protected>} />
    <Route path="/rep/record" element={<Protected roles={["rep"]}><RepRecordSale /></Protected>} />
    <Route path="/rep/claim" element={<Navigate to="/rep/record" replace />} />
    <Route path="/rep/earnings" element={<Protected roles={["rep"]}><RepEarnings /></Protected>} />
    <Route path="/rep/support" element={<Protected roles={["rep"]}><RepSupport /></Protected>} />
    <Route path="/rep/team" element={<Protected roles={["rep"]}><RepTeam /></Protected>} />
    <Route path="/vendor" element={<Protected roles={["vendor"]}><Vendor /></Protected>} />
    <Route path="/ops" element={<Protected roles={STAFF}><Ops /></Protected>} />
    <Route path="/sales" element={<Protected><Sales /></Protected>} />
    <Route path="/architecture" element={<Protected roles={STAFF}><Architecture /></Protected>} />
    <Route path="/identity" element={<Protected><Identity /></Protected>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
