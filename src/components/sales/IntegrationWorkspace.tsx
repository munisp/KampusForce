import { useState } from "react";
import { Cable, CheckCircle2, PlugZap, RefreshCw, ShieldAlert } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export function IntegrationWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.integrations.useQuery({ token });
  const vendor = trpc.vendor.overview.useQuery({ token }, { enabled: user.role === "vendor" });
  const [vendorId, setVendorId] = useState(0);
  const [service, setService] = useState<"catalog" | "crm" | "support" | "messaging">("catalog");
  const [displayName, setDisplayName] = useState("Local vendor service adapter");
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const refresh = () => utils.sales.integrations.invalidate();
  const create = trpc.sales.createVendorService.useMutation({ onSuccess: refresh });
  const test = trpc.sales.testVendorService.useMutation({ onSuccess: refresh });
  const sync = trpc.sales.syncVendorService.useMutation({ onSuccess: refresh });
  if (query.isLoading || vendor.isLoading) return <Loading label="Loading vendor-service connections…" />;
  if (query.error || vendor.error) return <ErrorState message={query.error?.message || vendor.error?.message || "Integration load failed"} retry={() => { query.refetch(); if (user.role === "vendor") vendor.refetch(); }} />;
  const data = query.data!;
  const errors = [create.error, test.error, sync.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><ShieldAlert size={18} /><p><strong>{data.boundary}</strong> Credentials belong in an external secret manager and are never collected here. Live execution remains separately authorized and fail-closed.</p></div>
    <div className="metrics-grid"><Metric label="Configured services" value={data.metrics.configured} note="Catalog, CRM, support and messaging" /><Metric label="Locally verified" value={data.metrics.verified} note="Adapter and active vendor record" tone="teal" /><Metric label="Sandbox adapters" value={data.metrics.sandbox} note="No external request made" /><Metric label="Degraded" value={data.metrics.degraded} note="Requires configuration review" tone={data.metrics.degraded ? "danger" : "default"} /></div>
    <Panel title="Configure a vendor service"><form className="sales-create-form integration-create" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, vendorId: user.role === "vendor" ? vendor.data!.vendor.id : vendorId, service, displayName, mode }); }}>{user.role !== "vendor" && <label>Vendor<select required value={vendorId} onChange={(event) => setVendorId(Number(event.target.value))}><option value={0}>Choose vendor</option>{data.vendorOptions.map((option) => <option key={option.id} value={option.id}>{option.companyName}</option>)}</select></label>}<label>Service<select value={service} onChange={(event) => setService(event.target.value as typeof service)}><option value="catalog">Catalog records</option><option value="crm">CRM opportunities</option><option value="support">Support cases</option><option value="messaging">Messaging outcomes</option></select></label><label>Display name<input required minLength={3} maxLength={160} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Execution mode<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="sandbox">Sandbox · local only</option><option value="live">Live · authorization required</option></select></label><button className="button primary" disabled={create.isPending}><PlugZap size={15} />Configure without credentials</button></form></Panel>
    <div className="integration-grid">{data.connections.length ? data.connections.map((row) => <Panel key={row.connection.id} title={row.connection.displayName} action={<StateBadge state={row.connection.state} />}><div className="integration-facts"><span><strong>{row.vendorName}</strong>Vendor</span><span><strong>{row.connection.service}</strong>Service</span><span><strong>{row.connection.mode}</strong>Mode</span><span><strong>{shortDate(row.connection.lastSyncedAt)}</strong>Last sync</span></div><p className="panel-note">Manual synchronization · external credential required for any real adapter · local tests do not establish vendor availability.</p><div className="case-actions"><button className="button secondary small" onClick={() => test.mutate({ token, connectionId: row.connection.id })} disabled={test.isPending}><CheckCircle2 size={14} />Test local adapter</button><button className="button primary small" onClick={() => sync.mutate({ token, connectionId: row.connection.id })} disabled={sync.isPending || row.connection.state !== "verified" || row.connection.mode !== "sandbox"}><RefreshCw size={14} />Sync local counts</button></div></Panel>) : <Panel title="Connection register"><EmptyState title="No vendor services configured" detail="Add a sandbox adapter, test its local preconditions, then reconcile local record counts." /></Panel>}</div>
    {data.events.length > 0 && <Panel title="Integration evidence"><div className="sales-timeline">{data.events.map((event) => <article key={event.id}><span>{shortDate(event.createdAt)}</span><div><strong>{event.eventType.replaceAll("_", " ")} · {event.status}</strong><p>{event.detail}</p></div></article>)}</div></Panel>}
    <div className="support-principle"><Cable size={19} /><p><strong>Settlement boundary:</strong> service synchronization only reconciles operational record counts. It does not accept provider outcomes, alter deals, move escrow or settle payouts.</p></div>
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
