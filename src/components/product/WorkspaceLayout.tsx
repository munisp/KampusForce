import { BarChart3, BookOpenCheck, CircleDollarSign, ClipboardCheck, ExternalLink, LayoutDashboard, LogOut, PackageOpen, QrCode, Settings2, ShieldCheck, Store } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { Brand } from "./Brand";
import { useWorkspace } from "@/providers/workspace";
import { trpc } from "@/providers/trpc";

const navByRole = {
  rep: [
    { to: "/rep", label: "Overview", icon: LayoutDashboard },
    { to: "/rep/catalog", label: "Product catalog", icon: PackageOpen },
    { to: "/rep/share", label: "Share & attribute", icon: QrCode },
    { to: "/rep/assist", label: "Assisted onboarding", icon: ClipboardCheck },
    { to: "/rep/earnings", label: "Earnings ledger", icon: CircleDollarSign },
  ],
  vendor: [{ to: "/vendor", label: "Vendor command", icon: Store }],
  ops: [{ to: "/ops", label: "Operations control", icon: ShieldCheck }],
};

export function WorkspaceLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { user, token, setSession } = useWorkspace();
  const navigate = useNavigate();
  const logout = trpc.auth.logout.useMutation({ onSettled: () => { setSession(null); navigate("/"); } });
  const nav = navByRole[user.role as keyof typeof navByRole] || navByRole.rep;
  return <div className="workspace-shell">
    <aside className="sidebar">
      <Brand inverse />
      <div className="workspace-label">{user.role} workspace<span>Phase 1 · sandbox</span></div>
      <nav aria-label="Workspace navigation">
        {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/rep"}><Icon size={18} />{label}</NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/implementation"><BarChart3 size={18} />Implementation score</NavLink>
        <button onClick={() => logout.mutate({ token })}><LogOut size={18} />Switch workspace</button>
      </div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header">
        <div><p className="eyebrow">{user.name}</p><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="header-status"><span className="live-dot" />Systems operational<small>Sandbox adapters</small></div>
      </header>
      {children}
    </main>
    <nav className="mobile-nav" aria-label="Mobile workspace navigation">
      {nav.slice(0, 5).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/rep"}><Icon size={20} /><span>{label.split(" ")[0]}</span></NavLink>)}
      <NavLink to="/implementation"><BookOpenCheck size={20} /><span>Score</span></NavLink>
    </nav>
    <button className="mobile-logout" onClick={() => logout.mutate({ token })} aria-label="Switch workspace"><ExternalLink size={18} /></button>
  </div>;
}

export function Metric({ label, value, note, tone = "default" }: { label: string; value: string | number; note: string; tone?: string }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><Settings2 size={24} /><strong>{title}</strong><p>{detail}</p></div>;
}
