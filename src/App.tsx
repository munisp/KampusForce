import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useWorkspace } from "@/providers/workspace";
import Login from "@/pages/Login";
import { RepAssist, RepCatalog, RepEarnings, RepOverview, RepShare } from "@/pages/Rep";
import Vendor from "@/pages/Vendor";
import Ops from "@/pages/Ops";
import Implementation from "@/pages/Implementation";

function Protected({ children }: { children: ReactNode }) {
  const { token } = useWorkspace();
  return token ? children : <Navigate to="/" replace />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<Login />} />
    <Route path="/rep" element={<Protected><RepOverview /></Protected>} />
    <Route path="/rep/catalog" element={<Protected><RepCatalog /></Protected>} />
    <Route path="/rep/share" element={<Protected><RepShare /></Protected>} />
    <Route path="/rep/assist" element={<Protected><RepAssist /></Protected>} />
    <Route path="/rep/earnings" element={<Protected><RepEarnings /></Protected>} />
    <Route path="/vendor" element={<Protected><Vendor /></Protected>} />
    <Route path="/ops" element={<Protected><Ops /></Protected>} />
    <Route path="/implementation" element={<Implementation />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
