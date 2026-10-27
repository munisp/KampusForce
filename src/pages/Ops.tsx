import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Clock3, FastForward, Gavel, Play, ReceiptText, ShieldCheck, X } from "lucide-react";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export default function Ops() {
  const { token } = useWorkspace();
  const overview = trpc.ops.overview.useQuery({ token });
  const utils = trpc.useUtils();
  const [notice, setNotice] = useState("");
  const [caseId, setCaseId] = useState<number | null>(null);
  const [decision, setDecision] = useState("");
  const refresh = () => { utils.ops.overview.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.earnings.invalidate(); utils.vendor.overview.invalidate(); };
  const advance = trpc.ops.advanceWindows.useMutation({ onSuccess: () => { setNotice("Sandbox confirmation windows advanced. Run the confirmation sweep next."); refresh(); } });
  const confirm = trpc.ops.confirmSweep.useMutation({ onSuccess: (d) => { setNotice(`Confirmation sweep complete: ${d.confirmed} confirmed, ${d.queuedForEscrow} awaiting escrow.`); refresh(); } });
  const payout = trpc.ops.payoutBatch.useMutation({ onSuccess: (d) => { setNotice(`Payout batch complete: ${d.results.filter((r) => r.status === "paid").length} paid, ${d.results.filter((r) => r.status !== "paid").length} held or below minimum.`); refresh(); } });
  const resolve = trpc.ops.resolveDispute.useMutation({ onSuccess: () => { setCaseId(null); setDecision(""); setNotice("Dispute decision recorded in the audit log."); refresh(); } });
  const actionError = advance.error || confirm.error || payout.error || resolve.error;
  if (overview.isLoading) return <WorkspaceLayout title="Operations control" subtitle="Confirmation, escrow, payout and dispute controls."><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Operations control" subtitle="Confirmation, escrow, payout and dispute controls."><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  return <WorkspaceLayout title="Operations control" subtitle="Move every deal deliberately—and leave an audit trail.">
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>Controlled sandbox.</strong> Time advancement and bank transfers are explicit test adapters. Production schedules require 09:00 WAT workers and live provider status reconciliation.</p></div>
    <div className="metrics-grid ops-metrics"><Metric label="All deals" value={data.metrics.deals} note="Across every vendor and rep" /><Metric label="Pending" value={data.metrics.pending} note="Awaiting confirmation or escrow" tone="mustard" /><Metric label="Payable" value={data.metrics.payable} note="Eligible for pre-flight checks" tone="teal" /><Metric label="Paid" value={data.metrics.paid} note="Completed sandbox transfers" /><Metric label="Quarantined" value={data.metrics.quarantined} note="Events requiring investigation" tone={data.metrics.quarantined ? "danger" : "default"} /><Metric label="Open disputes" value={data.metrics.openDisputes} note="Rep cases awaiting decision" tone={data.metrics.openDisputes ? "mustard" : "default"} /></div>
    <Panel title="Settlement runbook" className="runbook-panel">
      <div className="runbook-steps">
        <div><span>01</span><FastForward size={21} /><p><strong>Advance test windows</strong><small>Sandbox only: make pending confirmation dates due.</small></p><button className="button secondary" onClick={() => advance.mutate({ token })} disabled={advance.isPending}>Advance <ArrowRight size={15} /></button></div>
        <div><span>02</span><CheckCircle2 size={21} /><p><strong>Confirm & reserve escrow</strong><small>Post double-entry credits only when vendor funds cover the deal.</small></p><button className="button secondary" onClick={() => confirm.mutate({ token })} disabled={confirm.isPending}>Run sweep <Play size={15} /></button></div>
        <div><span>03</span><ReceiptText size={21} /><p><strong>Run payout batch</strong><small>Check KYC, name match, ₦500 minimum and negative balances.</small></p><button className="button primary" onClick={() => payout.mutate({ token })} disabled={payout.isPending}>Pay eligible <ArrowRight size={15} /></button></div>
      </div>
      {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}{actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    </Panel>
    <Panel title="Deal monitor" action={<span className="result-count">Latest {data.deals.length} of {data.metrics.deals}</span>}>
      {data.deals.length ? <div className="table-wrap"><table><thead><tr><th>Deal / rep</th><th>Product</th><th>Event</th><th>Created</th><th>State</th><th>Rep commission</th><th>Escrow + platform</th></tr></thead><tbody>{data.deals.map(({ deal, productName, repCode }) => <tr key={deal.id}><td><strong>#{deal.id}</strong><small className="table-sub mono">{repCode}</small></td><td>{productName}</td><td>{deal.triggerEvent.replaceAll("_", " ")}</td><td>{shortDate(deal.createdAt)}</td><td><StateBadge state={deal.state} /></td><td><strong>{money(deal.repCommissionKobo)}</strong></td><td>{money(deal.vendorCommissionKobo)} / {money(deal.platformFeeKobo)}</td></tr>)}</tbody></table></div> : <EmptyState title="No deals to monitor" detail="Use the rep and vendor sandboxes to create an attributed activation." />}
    </Panel>
    <div className="ops-lower-grid">
      <Panel title="Event quarantine" className="quarantine-panel">
        {data.quarantine.length ? <div className="quarantine-list">{data.quarantine.map((event) => <div key={event.id}><AlertTriangle size={18} /><p><strong>{event.quarantineReason || "Manual review required"}</strong><small>{event.type} · {shortDate(event.receivedAt)}</small><span className="mono">KF {event.id.slice(0, 12)}…</span></p></div>)}</div> : <EmptyState title="Quarantine is clear" detail="Unknown products, missing attribution and invalid commission events will appear here." />}
      </Panel>
      <Panel title="Dispute desk">
        {data.disputes.length ? <div className="case-list">{data.disputes.map(({ dispute, openedBy }) => <div key={dispute.id}><Gavel size={19} /><p><strong>Case #{dispute.id} · Deal #{dispute.dealId}</strong><small>{openedBy} · {dispute.reasonCode.replaceAll("_", " ")}</small><StateBadge state={dispute.state} />{dispute.decision && <em>{dispute.decision}</em>}</p>{["open", "reviewing"].includes(dispute.state) && <button className="button secondary small" onClick={() => setCaseId(dispute.id)}>Decide</button>}</div>)}</div> : <EmptyState title="No disputes" detail="Rep-submitted cases and their decisions will remain visible here." />}
      </Panel>
    </div>
    <Panel title="Audit history">
      {data.audit.length ? <div className="audit-list">{data.audit.map((log) => <div key={log.id}><Clock3 size={16} /><span className="mono">{shortDate(log.createdAt)}</span><strong>{log.action}</strong><span>{log.entityType} · {log.entityId}</span><span>Actor {log.actorUserId || "system"}</span></div>)}</div> : <EmptyState title="No operator actions yet" detail="Confirmation, payout and dispute actions are appended here." />}
    </Panel>
    {caseId && <div className="modal-backdrop" onClick={() => setCaseId(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><p className="eyebrow">DISPUTE #{caseId}</p><h2>Record a decision</h2><p>Upholding the rep returns the deal to payable. Rejecting the claim voids it. The decision is audited.</p><label>Decision rationale<textarea value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Evidence reviewed and reason for this outcome" /></label><div className="decision-actions"><button className="button secondary" disabled={decision.length < 5 || resolve.isPending} onClick={() => resolve.mutate({ token, disputeId: caseId, decision, upholdRep: false })}><X size={16} />Reject claim</button><button className="button primary" disabled={decision.length < 5 || resolve.isPending} onClick={() => resolve.mutate({ token, disputeId: caseId, decision, upholdRep: true })}><Check size={16} />Uphold rep</button></div></div></div>}
  </WorkspaceLayout>;
}
