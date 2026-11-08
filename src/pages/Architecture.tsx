import { useState } from "react";
import { Activity, AlertTriangle, Check, FileClock, GitBranch } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type WindowDays = 7 | 30 | 90 | 365;

export default function Architecture() {
  const { token } = useWorkspace();
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const overview = trpc.architecture.overview.useQuery({ token, windowDays });
  const snapshot = trpc.architecture.captureSnapshot.useMutation({ onSuccess: (result) => { setNotice(`Snapshot saved (${result.snapshotRef.slice(0, 18)}…). The figures for this period are kept as they are now.`); utils.architecture.overview.invalidate(); } });
  if (overview.isLoading) return <WorkspaceLayout title="Reports" subtitle="Sales, money and support across KampusForce."><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Reports" subtitle="Sales, money and support across KampusForce."><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const { analytics: a } = overview.data!;
  const actionError = snapshot.error;
  return <WorkspaceLayout title="Reports" subtitle="Sales, money and support across KampusForce.">
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}

    <>
      <div className="architecture-toolbar"><div className="window-selector" aria-label="Time period">{([7, 30, 90, 365] as WindowDays[]).map((days) => <button key={days} className={windowDays === days ? "active" : ""} onClick={() => setWindowDays(days)}>{days} days</button>)}</div><button className="button secondary small" disabled={snapshot.isPending} onClick={() => snapshot.mutate({ token, windowDays })}><FileClock size={14} />Save a snapshot</button></div>
      <div className="metrics-grid ops-metrics"><Metric label="Activations" value={a.metrics.activations} note={`${a.metrics.confirmationRate}% confirmed`} /><Metric label="Vendor commission" value={money(a.metrics.vendorCommissionKobo)} note="Paid by vendors" tone="teal" /><Metric label="Rep commission" value={money(a.metrics.repCommissionKobo)} note="The 80% share, before lead bonuses" /><Metric label="Platform revenue" value={money(a.metrics.platformRevenueKobo)} note="Before lead bonuses; this isn't profit" /><Metric label="Paid net" value={money(a.metrics.payoutNetKobo)} note="Payouts completed" /><Metric label="Data quality" value={`${a.dataQuality.score}/100`} note="Health score" tone={a.dataQuality.score < 80 ? "danger" : "teal"} /><Metric label="Waiting to post" value={a.metrics.pendingPostings} note={`${a.metrics.failedPostings} failed groups`} tone={a.metrics.failedPostings ? "danger" : "mustard"} /><Metric label="Open cases" value={a.metrics.openCases} note="All support requests" /></div>
      <div className="architecture-analytics-grid">
        <Panel title="How each campus is doing" action={<span className="result-count">Database-grouped · {windowDays}-day window</span>}>
          {a.campusPerformance.length ? <div className="architecture-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={a.campusPerformance.slice(0, 10)} layout="vertical" margin={{ left: 12, right: 20 }}><CartesianGrid strokeDasharray="2 4" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="campus" width={110} tick={{ fontSize: 9 }} /><Tooltip formatter={(value, name) => [value, name === "confirmed" ? "Confirmed activations" : "All activations"]} /><Bar dataKey="activations" fill="#d9cfb8" radius={[0, 2, 2, 0]} /><Bar dataKey="confirmed" fill="#176b63" radius={[0, 2, 2, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="No sales in this period" detail="Try a longer time period." />}
        </Panel>
        <Panel title="Things to check" action={<Activity size={18} />}>
          {a.findings.length ? <div className="architecture-findings">{a.findings.map((finding) => <div key={finding.code} className={finding.severity}><AlertTriangle size={17} /><p><strong>{finding.code.replaceAll("_", " ")}</strong><small>{finding.detail}</small></p><StateBadge state={finding.severity} /></div>)}</div> : <EmptyState title="Nothing to check" detail="We didn't find any problems with sales, payments or bank checks." />}
        </Panel>
      </div>
      <div className="architecture-analytics-grid">
        <Panel title="Sales over time" action={<span className="result-count">Over time</span>}>
          {a.dailyTrend.length ? <div className="architecture-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={a.dailyTrend} margin={{ left: 0, right: 16 }}><CartesianGrid strokeDasharray="2 4" vertical={false} /><XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} width={32} /><Tooltip /><Line type="monotone" dataKey="activations" name="Created activations" stroke="#d0a33c" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="confirmed" name="First confirmations" stroke="#176b63" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <EmptyState title="No sales yet" detail="Sales will appear here." />}<p className="panel-note">{a.definitions.dailyTrend}</p>
        </Panel>
        <Panel title="Sales confirmed within 7 days" action={<span className="result-count">Weeks start on Monday</span>}>
          {a.conversionCohorts.length ? <div className="table-wrap"><table><thead><tr><th>Week</th><th>All / mature</th><th>Confirmed ≤7d</th><th>Conversion</th></tr></thead><tbody>{a.conversionCohorts.map((row) => <tr key={row.week}><td><strong>{row.week}</strong></td><td>{row.activations} / {row.matureActivations}</td><td>{row.confirmedWithin7Days}</td><td>{row.conversionWithin7Days}%</td></tr>)}</tbody></table></div> : <EmptyState title="No sales yet" detail="This appears once there are sales." />}<p className="panel-note">{a.definitions.conversionCohorts}</p>
        </Panel>
      </div>
      <div className="architecture-analytics-grid">
        <Panel title="From referral to payment"><div className="table-wrap"><table><thead><tr><th>State</th><th>Records</th><th>Window share</th></tr></thead><tbody>{a.funnel.map((row) => <tr key={row.state}><td><StateBadge state={row.state} /></td><td><strong>{row.count}</strong></td><td>{row.share}%</td></tr>)}</tbody></table></div><p className="panel-note">{a.definitions.confirmationRate}</p></Panel>
        <Panel title="By vendor"><div className="table-wrap"><table><thead><tr><th>Vendor</th><th>Share confirmed</th><th>Rate</th><th>Commission</th></tr></thead><tbody>{a.vendorPerformance.map((row) => <tr key={row.vendorId}><td><strong>{row.vendor}</strong></td><td>{row.confirmed} / {row.activations}</td><td>{row.confirmationRate}%</td><td>{money(row.commissionKobo)}</td></tr>)}</tbody></table></div><p className="panel-note">{a.definitions.platformRevenue}</p></Panel>
      </div>
      <Panel title="Metric contracts & reproducibility" action={<GitBranch size={18} />}><div className="metric-contracts"><div><strong>Totals only</strong><p>These are totals, so no customer phone numbers, NINs, BVNs or bank details appear.</p></div><div><strong>Saved snapshots</strong><p>Each snapshot keeps its numbers, so you can compare them later.</p></div><div><strong>What the numbers mean</strong><p>{a.definitions.dataQuality}</p></div><div><strong>Recent snapshots</strong><p>{a.recentSnapshots.length ? a.recentSnapshots.map((item) => <span className="mono snapshot-line" key={item.snapshotRef}>{shortDate(item.createdAt)} · {item.windowDays}d · {item.payloadHash.slice(0, 12)}…</span>) : "No snapshot captured yet."}</p></div></div></Panel>
    </>
  </WorkspaceLayout>;
}
