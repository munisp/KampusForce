import { Bell, CheckCheck, CircleDollarSign, HandCoins, ClipboardCheck, LayoutDashboard, LifeBuoy, LogOut, Network, PackageOpen, QrCode, Settings2, ShieldCheck, Store, UserCheck, UsersRound, Workflow, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brand } from "./Brand";
import { endProviderSession } from "@/lib/oidc";
import { useWorkspace } from "@/providers/workspace";
import { trpc } from "@/providers/trpc";

const navByRole = {
  // In the order a rep works: find a product, sell it, get paid. The phone menu shows the first five.
  rep: [
    { to: "/rep", label: "Overview", icon: LayoutDashboard },
    { to: "/rep/catalog", label: "Products", icon: PackageOpen },
    { to: "/rep/record", label: "Record a sale", icon: HandCoins },
    { to: "/rep/earnings", label: "Earnings", icon: CircleDollarSign },
    { to: "/rep/share", label: "Share a product", icon: QrCode },
    { to: "/rep/assist", label: "Help a customer", icon: ClipboardCheck },
    { to: "/sales", label: "Sales tools", icon: Workflow },
    { to: "/rep/team", label: "My team", icon: UsersRound },
    { to: "/rep/support", label: "Support", icon: LifeBuoy },
    { to: "/identity", label: "Verification", icon: ShieldCheck },
  ],
  vendor: [{ to: "/vendor", label: "Dashboard", icon: Store }, { to: "/identity", label: "Verification", icon: ShieldCheck }, { to: "/sales", label: "Sales tools", icon: Workflow }],
  ops: [{ to: "/ops", label: "Operations", icon: ShieldCheck }, { to: "/identity", label: "ID checks", icon: UserCheck }, { to: "/sales", label: "Sales tools", icon: Workflow }, { to: "/architecture", label: "Reports", icon: Network }],
  finance: [{ to: "/ops", label: "Operations", icon: ShieldCheck }, { to: "/identity", label: "ID checks", icon: UserCheck }, { to: "/sales", label: "Sales tools", icon: Workflow }, { to: "/architecture", label: "Reports", icon: Network }],
  admin: [{ to: "/ops", label: "Operations", icon: ShieldCheck }, { to: "/identity", label: "ID checks", icon: UserCheck }, { to: "/sales", label: "Sales tools", icon: Workflow }, { to: "/architecture", label: "Reports", icon: Network }],
};

type SystemStatus = { status?: string; mode?: string; paymentsTest?: boolean; checks?: { database?: string; worker?: string } };

export function useSystemStatus() {
  const query = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => (await (await fetch("/api/health/ready")).json()) as SystemStatus,
    refetchInterval: 60_000,
    retry: false,
  });
  const data = query.data;
  const unreachable = query.isError || (!query.isLoading && !data?.status);
  const headline = query.isLoading ? "Checking…" : unreachable ? "Can't check the system" : data?.status === "ready" ? "All systems working" : data?.checks?.database === "down" ? "System problem" : "Some updates are delayed";
  return { headline, healthy: data?.status === "ready", checking: query.isLoading, testMode: data?.mode === "sandbox", live: data?.mode === "live", paymentsTest: Boolean(data?.paymentsTest) };
}

function NotificationCenter() {
  const { token } = useWorkspace();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const inbox = trpc.notification.list.useQuery({ token }, { refetchInterval: 30_000 });
  const read = trpc.notification.read.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  const readAll = trpc.notification.readAll.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  const unread = inbox.data?.unread || 0;
  return <div className="notification-center">
    <button className="icon-button notification-trigger" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell size={18} />{unread > 0 && <span>{unread}</span>}</button>
    {open && <div className="notification-popover"><div className="notification-head"><strong>Notifications</strong><span className="notification-actions"><button className="text-link" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate({ token })}><CheckCheck size={14} />Mark all read</button><button className="icon-button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={15} /></button></span></div><div className="notification-list">{inbox.data?.notifications.length ? inbox.data.notifications.map((item) => <button key={item.id} className={item.readAt ? "read" : "unread"} onClick={() => { if (!item.readAt) read.mutate({ token, notificationId: item.id }); if (item.href) { navigate(item.href); setOpen(false); } }}><span><strong>{item.title}</strong><small>{item.body}</small><em>{new Date(item.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</em></span>{!item.readAt && <i aria-label="Unread" />}</button>) : <div className="notification-empty">No notifications yet.</div>}</div></div>}
  </div>;
}

export function WorkspaceLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { user, token, setSession } = useWorkspace();
  const navigate = useNavigate();
  const logout = trpc.auth.logout.useMutation({ onSettled: () => { setSession(null); if (!endProviderSession()) navigate("/"); } });
  const nav = navByRole[user.role as keyof typeof navByRole] || navByRole.rep;
  const system = useSystemStatus();
  const modeLabel = system.live ? "Live" : system.testMode ? "Test mode" : "";
  const roleLabel = ({ rep: "Campus rep", vendor: "Vendor", ops: "Operations", finance: "Finance", admin: "Admin" } as Record<string, string>)[user.role] || user.role;
  return <div className="workspace-shell">
    <aside className="sidebar">
      <Brand inverse />
      <div className="workspace-label">{roleLabel}{modeLabel && <span>{modeLabel}</span>}</div>
      <nav aria-label="Workspace navigation">
        {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/rep"}><Icon size={18} />{label}</NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <button onClick={() => logout.mutate({ token })}><LogOut size={18} />Sign out</button>
      </div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header">
        <div><p className="eyebrow">{user.name}</p><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="header-actions"><div className={`header-status${system.healthy || system.checking ? "" : " header-status-problem"}`} role="status"><span className="live-dot" />{system.headline}{modeLabel && <small>{system.testMode ? "Test mode: no real money" : modeLabel}</small>}</div><NotificationCenter /></div>
      </header>
      {children}
    </main>
    <nav className="mobile-nav" aria-label="Mobile workspace navigation">
      {nav.slice(0, 5).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/rep"}><Icon size={20} /><span>{label.split(" ")[0]}</span></NavLink>)}
    </nav>
    <button className="mobile-logout" onClick={() => logout.mutate({ token })} aria-label="Sign out"><LogOut size={18} /></button>
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
