import { BarChart3, Bell, BookOpenCheck, CheckCheck, CircleDollarSign, ClipboardCheck, ExternalLink, LayoutDashboard, LifeBuoy, LogOut, PackageOpen, QrCode, Settings2, ShieldCheck, Store, UsersRound, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { useState, type ReactNode } from "react";
import { Brand } from "./Brand";
import { useWorkspace } from "@/providers/workspace";
import { trpc } from "@/providers/trpc";

const navByRole = {
  rep: [
    { to: "/rep", label: "Overview", icon: LayoutDashboard },
    { to: "/rep/catalog", label: "Product catalog", icon: PackageOpen },
    { to: "/rep/share", label: "Share & attribute", icon: QrCode },
    { to: "/rep/support", label: "Support inbox", icon: LifeBuoy },
    { to: "/rep/team", label: "Campus team", icon: UsersRound },
    { to: "/rep/earnings", label: "Earnings ledger", icon: CircleDollarSign },
    { to: "/rep/assist", label: "Assisted onboarding", icon: ClipboardCheck },
  ],
  vendor: [{ to: "/vendor", label: "Vendor command", icon: Store }],
  ops: [{ to: "/ops", label: "Operations control", icon: ShieldCheck }],
};

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
    {open && <div className="notification-popover"><div className="notification-head"><strong>In-app notifications</strong><span className="notification-actions"><button className="text-link" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate({ token })}><CheckCheck size={14} />Mark all read</button><button className="icon-button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={15} /></button></span></div><p className="notification-boundary">Product events only—no SMS or email delivery is implied.</p><div className="notification-list">{inbox.data?.notifications.length ? inbox.data.notifications.map((item) => <button key={item.id} className={item.readAt ? "read" : "unread"} onClick={() => { if (!item.readAt) read.mutate({ token, notificationId: item.id }); if (item.href) { navigate(item.href); setOpen(false); } }}><span><strong>{item.title}</strong><small>{item.body}</small><em>{new Date(item.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</em></span>{!item.readAt && <i aria-label="Unread" />}</button>) : <div className="notification-empty">No notifications yet. Recruitment, activation, and payout events will appear here.</div>}</div></div>}
  </div>;
}

export function WorkspaceLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { user, token, setSession } = useWorkspace();
  const navigate = useNavigate();
  const logout = trpc.auth.logout.useMutation({ onSettled: () => { setSession(null); navigate("/"); } });
  const nav = navByRole[user.role as keyof typeof navByRole] || navByRole.rep;
  return <div className="workspace-shell">
    <aside className="sidebar">
      <Brand inverse />
      <div className="workspace-label">{user.role} workspace<span>Phase 3 · sandbox</span></div>
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
        <div className="header-actions"><div className="header-status"><span className="live-dot" />Systems operational<small>Sandbox adapters</small></div><NotificationCenter /></div>
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
