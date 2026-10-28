import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useWorkspace } from "@/providers/workspace";

const Login = lazy(() => import("@/pages/Login"));
const Vendor = lazy(() => import("@/pages/Vendor"));
const Ops = lazy(() => import("@/pages/Ops"));
const Implementation = lazy(() => import("@/pages/Implementation"));
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
const RepEarnings = lazy(() => import("@/pages/Rep").then((module) => ({ default: module.RepEarnings })));

function Protected({ children }: { children: ReactNode }) {
  const { token } = useWorkspace();
  return token ? children : <Navigate to="/" replace />;
}

export default function App() {
  return <Suspense fallback={<div className="route-loading" role="status">Loading workspace…</div>}><Routes>
    <Route path="/" element={<Login />} />
    <Route path="/recruit/accept" element={<RecruitAccept />} />
    <Route path="/rep" element={<Protected><RepOverview /></Protected>} />
    <Route path="/rep/catalog" element={<Protected><RepCatalog /></Protected>} />
    <Route path="/rep/share" element={<Protected><RepShare /></Protected>} />
    <Route path="/rep/assist" element={<Protected><RepAssist /></Protected>} />
    <Route path="/rep/earnings" element={<Protected><RepEarnings /></Protected>} />
    <Route path="/rep/support" element={<Protected><RepSupport /></Protected>} />
    <Route path="/rep/team" element={<Protected><RepTeam /></Protected>} />
    <Route path="/vendor" element={<Protected><Vendor /></Protected>} />
    <Route path="/ops" element={<Protected><Ops /></Protected>} />
    <Route path="/sales" element={<Protected><Sales /></Protected>} />
    <Route path="/architecture" element={<Protected><Architecture /></Protected>} />
    <Route path="/identity" element={<Protected><Identity /></Protected>} />
    <Route path="/implementation" element={<Implementation />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
