import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleDollarSign, FlaskConical, Plus, Radio, ShieldCheck, Wallet } from "lucide-react";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export default function Vendor() {
  const { token } = useWorkspace();
  const overview = trpc.vendor.overview.useQuery({ token });
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("100000");
  const [productRef, setProductRef] = useState("");
  const [type, setType] = useState<"account_created" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "refund">("funded");
  const [phone, setPhone] = useState("08011112222");
  const [eventAmount, setEventAmount] = useState("10000");
  const topup = trpc.vendor.topupEscrow.useMutation({ onSuccess: () => utils.vendor.overview.invalidate() });
  const simulate = trpc.vendor.simulateEvent.useMutation({ onSuccess: () => { utils.vendor.overview.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.earnings.invalidate(); } });
  if (overview.isLoading) return <WorkspaceLayout title="Vendor command" subtitle="Escrow, commission rules and verified events."><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Vendor command" subtitle="Escrow, commission rules and verified events."><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  const selectedRef = productRef || data.catalog[0]?.product.vendorRef || "";
  const selected = data.catalog.find((c) => c.product.vendorRef === selectedRef);
  const wallet = data.wallet;
  const counts = data.funnel.reduce((acc, d) => { acc[d.state] = (acc[d.state] || 0) + 1; return acc; }, {} as Record<string, number>);
  const gross = data.funnel.reduce((sum, d) => sum + (["paid", "payable", "confirmed"].includes(d.state) ? d.vendorCommissionKobo : 0), 0);
  return <WorkspaceLayout title={data.vendor.companyName} subtitle="Verify real activations; KampusForce handles attribution and settlement.">
    <div className="sandbox-banner"><FlaskConical size={18} /><p><strong>Sandbox partner adapter.</strong> Top-ups and simulated events exercise production-shaped records but do not call a bank, payment processor or KYC provider.</p></div>
    <div className="metrics-grid"><Metric label="Escrow available" value={money(wallet?.balanceKobo || 0)} note="Pre-funded commission reserve" tone="teal" /><Metric label="Tracked activations" value={data.funnel.length} note={`${counts.pending || 0} awaiting confirmation`} /><Metric label="Confirmed commission" value={money(gross)} note="Confirmed, payable and paid states" tone="mustard" /><Metric label="Active products" value={data.catalog.filter((c) => c.product.status === "active").length} note="Versioned commercial terms" /></div>
    <div className="vendor-grid">
      <Panel title="Commission escrow" className="escrow-panel">
        <div className="wallet-visual"><Wallet size={25} /><span>VENDOR PRE-FUNDING</span><strong>{money(wallet?.balanceKobo || 0)}</strong><small>Low-balance alert at {money(wallet?.lowBalanceThresholdKobo || 0)}</small></div>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); topup.mutate({ token, amountKobo: Math.round(Number(amount) * 100) }); }}><label>Sandbox top-up (₦)<input type="number" min="100" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><button className="button secondary" disabled={topup.isPending}><Plus size={16} />Add funds</button></form>
        {topup.data && <p className="success-message"><CheckCircle2 size={16} />{topup.data.provider}: balance now {money(topup.data.balanceKobo)}</p>}{topup.error && <p className="form-error">{topup.error.message}</p>}
        <p className="panel-footnote">Underfunded activations remain pending. KampusForce never fronts vendor commission.</p>
      </Panel>
      <Panel title="Simulate a vendor event" className="event-panel">
        <form className="form-stack" onSubmit={(e) => { e.preventDefault(); simulate.mutate({ token, productRef: selectedRef, type, customerPhone: phone, amountKobo: Math.round(Number(eventAmount) * 100) }); }}>
          <div className="form-row"><label>Product<select value={selectedRef} onChange={(e) => { setProductRef(e.target.value); const rule = data.catalog.find((c) => c.product.vendorRef === e.target.value)?.rule; if (rule) setType(rule.triggerEvent === "signup" ? "account_created" : rule.triggerEvent); }}>{data.catalog.map(({ product }) => <option key={product.id} value={product.vendorRef}>{product.name}</option>)}</select></label><label>Event type<select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="account_created">Account created</option><option value="kyc_complete">KYC complete</option><option value="funded">Funded</option><option value="first_transaction">First transaction</option><option value="renewal">Renewal</option><option value="refund">Refund / reversal</option></select></label></div>
          <div className="form-row"><label>Customer phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><label>Transaction value (₦)<input type="number" min="1" value={eventAmount} onChange={(e) => setEventAmount(e.target.value)} /></label></div>
          <p className="privacy-note"><ShieldCheck size={16} />Use the same phone as the rep attribution. Only normalized hashes enter KampusForce records.</p>
          {selected && <p className="rule-hint"><Radio size={15} />This product earns on <strong>{selected.rule.triggerEvent.replaceAll("_", " ")}</strong>; other non-refund events are ignored.</p>}
          <button className="button primary" disabled={simulate.isPending || !selectedRef}>{simulate.isPending ? "Sending…" : "Send signed sandbox event"}<ArrowRight size={16} /></button>
        </form>
        {simulate.data && <div className="event-receipt"><CheckCircle2 size={20} /><div><strong>Event {simulate.data.status}</strong><p>{simulate.data.deal_id ? `Deal #${simulate.data.deal_id} created or updated.` : simulate.data.reason || "No commissionable deal created."}</p></div></div>}{simulate.error && <p className="form-error">{simulate.error.message}</p>}
      </Panel>
    </div>
    <Panel title="Published products & commission rules">
      <div className="table-wrap"><table><thead><tr><th>Product</th><th>Vendor ref</th><th>Trigger</th><th>Vendor commission</th><th>Confirmation</th><th>Clawback</th><th>Status</th></tr></thead><tbody>{data.catalog.map(({ product, rule }) => <tr key={product.id}><td><strong>{product.name}</strong><small className="table-sub">Rule version {rule.version}</small></td><td className="mono">{product.vendorRef}</td><td>{rule.triggerEvent.replaceAll("_", " ")}</td><td><strong>{rule.basis === "flat" ? money(rule.flatAmountKobo || 0) : `${(rule.pctBps || 0) / 100}%`}</strong><small className="table-sub">80% rep / 20% platform</small></td><td>{rule.confirmDays} days</td><td>{rule.clawbackDays} days</td><td><StateBadge state={product.status} /></td></tr>)}</tbody></table></div>
    </Panel>
    <Panel title="Activation funnel" action={<span className="result-count">{data.funnel.length} records</span>}>
      {data.funnel.length ? <div className="table-wrap"><table><thead><tr><th>Deal</th><th>Event</th><th>Created</th><th>State</th><th>Vendor commission</th><th>Rep / platform</th></tr></thead><tbody>{data.funnel.map((deal) => <tr key={deal.id}><td className="mono">#{deal.id}</td><td>{deal.triggerEvent.replaceAll("_", " ")}</td><td>{shortDate(deal.createdAt)}</td><td><StateBadge state={deal.state} /></td><td><strong>{money(deal.vendorCommissionKobo)}</strong></td><td>{money(deal.repCommissionKobo)} / {money(deal.platformFeeKobo)}</td></tr>)}</tbody></table></div> : <EmptyState title="No activation events yet" detail="Generate rep attribution first, then send a qualifying sandbox event above." />}
    </Panel>
    <div className="vendor-principles"><div><CircleDollarSign size={20} /><p><strong>No customer markup</strong>Commission is funded by the vendor commercial agreement.</p></div><div><ShieldCheck size={20} /><p><strong>No customer KYC at KampusForce</strong>Sensitive onboarding stays in your regulated flow.</p></div></div>
  </WorkspaceLayout>;
}
