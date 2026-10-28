import { useState } from "react";
import { ArrowRight, Check, ClipboardCheck, FileScan, Fingerprint, KeyRound, RefreshCw, ShieldCheck, Store, UserCheck, Workflow } from "lucide-react";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { EnrollmentPanel } from "@/components/product/EnrollmentPanel";

export default function Identity() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const overview = trpc.identity.overview.useQuery({ token });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState("Reviewed the bounded evidence and independently confirmed the decision.");
  const [notice, setNotice] = useState("");
  const refresh = (message: string) => { setNotice(message); utils.identity.overview.invalidate(); };
  const openCase = trpc.identity.openCase.useMutation({ onSuccess: (result) => refresh(`Case ${result.identityCase.caseRef} is ready for consent and submission.`) });
  const consent = trpc.identity.consent.useMutation({ onSuccess: () => refresh("Privacy notice acknowledgement recorded.") });
  const submit = trpc.identity.submit.useMutation({ onSuccess: (result) => refresh(`${result.caseRef} submitted for processing.`) });
  const processSandbox = trpc.identity.processSandbox.useMutation({ onSuccess: (result) => refresh(`${result.caseRef} processed with synthetic control fixtures and routed to independent review.`) });
  const review = trpc.identity.review.useMutation({ onSuccess: (result) => refresh(`${result.identityCase.caseRef} changed to ${result.identityCase.state}.`) });
  const reverify = trpc.identity.reverify.useMutation({ onSuccess: (result) => refresh(`Reverification case ${result.identityCase.caseRef} opened.`) });
  const handoff = trpc.identity.customerHandoff.useMutation({ onSuccess: () => refresh("Vendor-regulated customer KYC handoff recorded; no customer identity data was accepted.") });
  const withdraw = trpc.identity.withdrawConsent.useMutation({ onSuccess: (result) => refresh(`${result.caseRef} revoked after consent withdrawal; a privacy-safe tombstone is required.`) });
  if (overview.isLoading) return <WorkspaceLayout title="Identity & onboarding" subtitle="KYC, KYB, liveness and review workflows."><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Identity & onboarding" subtitle="KYC, KYB, liveness and review workflows."><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  const selected = data.cases.find((item) => item.id === selectedId) || data.cases[0] || null;
  const privileged = ["ops", "admin"].includes(user.role);
  const ownCase = !!selected && selected.subjectType === "user" && selected.subjectId === user.id;
  const applicantControls = !privileged || ownCase;
  const reviewerControls = privileged && !ownCase;
  const actionError = openCase.error || consent.error || submit.error || processSandbox.error || review.error || reverify.error || handoff.error || withdraw.error;
  const caseType: "representative_kyc" | "vendor_kyb" | "operations_kyc" = user.role === "vendor" ? "vendor_kyb" : user.role === "rep" ? "representative_kyc" : "operations_kyc";
  const ownConsents = selected ? data.consents.filter((item) => item.caseId === selected.id && !item.withdrawnAt) : [];
  const selectedEvidence = selected ? data.evidence.filter((item) => item.caseId === selected.id) : [];
  const pendingReview = data.cases.filter((item) => ["submitted", "processing", "manual_review", "needs_more_info"].includes(item.state)).length;
  const approved = data.cases.filter((item) => item.approvalValid).length;
  return <WorkspaceLayout title="Identity & onboarding" subtitle="Event-driven stakeholder verification with privacy-safe evidence and independent review.">
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.readiness.liveEligible ? "External identity gates report configured." : "Sandbox identity controls only."}</strong> OCR, document parsing and VLM cross-checks do not prove liveness. No real provider verification, PAD/deepfake certification, legal approval or production readiness is implied by synthetic evidence.</p></div>
    <div className="metrics-grid ops-metrics"><Metric label="Visible cases" value={data.cases.length} note={privileged ? "Across scoped Operations queue" : "Your stakeholder workflow"} /><Metric label="Open review" value={pendingReview} note="Submission, processing or review" tone={pendingReview ? "mustard" : "teal"} /><Metric label="Current approvals" value={approved} note="Unexpired case decisions" /><Metric label="Live provider gate" value={data.readiness.liveEligible ? "Eligible" : "Blocked"} note={`${data.readiness.checks.filter((check) => check.ready).length}/${data.readiness.checks.length} readiness checks`} tone={data.readiness.liveEligible ? "teal" : "danger"} /></div>
    {user.role === "rep" && <EnrollmentPanel />}
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    <div className="architecture-toolbar"><div className="window-selector" aria-label="Open onboarding workflow">
      <button className={openCase.isPending ? "" : "active"} disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType })}>{user.role === "vendor" ? <Store size={15} /> : user.role === "rep" ? <UserCheck size={15} /> : <KeyRound size={15} />}{user.role === "vendor" ? "Start vendor KYB" : user.role === "rep" ? "Start representative KYC" : "Start Operations KYC"}</button>
      {user.role === "rep" && <button disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType: "campus_lead_kyc" })}><ShieldCheck size={15} />Campus Lead reverification</button>}
    </div>{user.role === "vendor" && <button className="button secondary small" disabled={handoff.isPending} onClick={() => handoff.mutate({ token })}><ArrowRight size={14} />Customer KYC handoff</button>}</div>
    <div className="architecture-analytics-grid identity-grid">
      <Panel title="Onboarding cases" action={<ClipboardCheck size={18} />}>
        {data.cases.length ? <div className="identity-case-list">{data.cases.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><strong>{item.caseRef}</strong><small>{item.caseType.replaceAll("_", " ")} · {item.triggerEvent.replaceAll("_", " ")}</small></span><StateBadge state={item.state} /></button>)}</div> : <EmptyState title="No identity case yet" detail="Start the stakeholder workflow above. Customer KYC remains inside the vendor-regulated service." />}
      </Panel>
      <Panel title="Case controls" action={selected ? <StateBadge state={selected.state} /> : undefined}>
        {selected ? <div className="identity-detail">
          <div className="identity-case-summary"><div><span>Policy</span><strong>{selected.policyVersion}</strong></div><div><span>Mode</span><strong>{selected.providerMode}</strong></div><div><span>Review due</span><strong>{selected.reviewDueAt ? shortDate(selected.reviewDueAt) : "—"}</strong></div><div><span>Valid until</span><strong>{selected.validUntil ? shortDate(selected.validUntil) : "—"}</strong></div></div>
          {selected.decisionReason && <p className="panel-note"><strong>Latest decision:</strong> {selected.decisionReason}</p>}
          {applicantControls && ["draft", "needs_more_info"].includes(selected.state) && <div className="identity-actions"><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "identity_verification")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "identity_verification", noticeAcknowledged: true })}><FileScan size={14} />Acknowledge identity notice</button><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "biometric_liveness")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "biometric_liveness", noticeAcknowledged: true })}><Fingerprint size={14} />Acknowledge liveness notice</button><button className="button small" disabled={submit.isPending || ownConsents.length < 2} onClick={() => submit.mutate({ token, caseId: selected.id })}>Submit for processing<ArrowRight size={14} /></button></div>}
          {reviewerControls && ["submitted", "processing", "needs_more_info"].includes(selected.state) && <button className="button secondary small" disabled={processSandbox.isPending} onClick={() => processSandbox.mutate({ token, caseId: selected.id })}><Workflow size={14} />Run synthetic sandbox controls</button>}
          {reviewerControls && selected.state === "manual_review" && <div className="identity-review"><label htmlFor="identity-review-reason">Independent review reason</label><textarea id="identity-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /><div className="identity-actions"><button className="button small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "approve", reason })}>Approve</button><button className="button secondary small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "request_info", reason })}>Request information</button><button className="button danger small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "reject", reason })}>Reject</button></div></div>}
          {applicantControls && <div className="identity-actions">{selected.reverificationDue && <button className="button secondary small" disabled={reverify.isPending} onClick={() => reverify.mutate({ token, caseId: selected.id })}><RefreshCw size={14} />Start reverification</button>}{ownConsents.length > 0 && !["revoked", "expired", "rejected"].includes(selected.state) && <button className="button danger small" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ token, caseId: selected.id })}>Withdraw consent & stop processing</button>}</div>}
        </div> : <EmptyState title="Select a case" detail="Case actions and evidence requirements will appear here." />}
      </Panel>
    </div>
    {selected && <div className="architecture-analytics-grid identity-grid">
      <Panel title="Required evidence" action={<span className="result-count">{selectedEvidence.length} bounded records</span>}>
        <div className="readiness-checks">{selected.requiredEvidence.map((kind) => { const passed = selectedEvidence.some((item) => item.kind === kind && item.state === "passed"); return <div key={kind}><span>{passed ? <Check size={14} /> : <Fingerprint size={14} />}</span><p><strong>{kind.replaceAll("_", " ")}</strong><small>{passed ? "Passing metadata recorded; no raw payload retained" : "Required before manual approval"}</small></p><StateBadge state={passed ? "verified" : "pending"} /></div>; })}</div>
      </Panel>
      <Panel title="Evidence provenance" action={<FileScan size={18} />}>
        {selectedEvidence.length ? <div className="table-wrap"><table><thead><tr><th>Control</th><th>Provider / model</th><th>Score</th><th>State</th></tr></thead><tbody>{selectedEvidence.map((item) => <tr key={item.id}><td><strong>{item.kind.replaceAll("_", " ")}</strong></td><td>{item.provider}<small className="table-subtitle">{item.modelVersion || "version unavailable"}</small></td><td>{item.score === null ? "—" : Number(item.score).toFixed(3)}</td><td><StateBadge state={item.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No evidence metadata" detail="Transient document and hosted biometric adapters add only bounded outcomes here." />}
      </Panel>
    </div>}
    <div className="architecture-analytics-grid identity-grid">
      <Panel title="Production readiness gates" action={<ShieldCheck size={18} />}><div className="readiness-checks">{data.readiness.checks.map((check) => <div key={check.key}><span>{check.ready ? <Check size={14} /> : <KeyRound size={14} />}</span><p><strong>{check.key.replaceAll("_", " ")}</strong><small>{check.detail}</small></p><StateBadge state={check.ready ? "verified" : "blocked"} /></div>)}</div></Panel>
      <Panel title="Event triggers" action={<Workflow size={18} />}><div className="identity-trigger-list">{data.triggers.map((trigger) => <div key={`${trigger.event}-${trigger.caseType}`}><strong>{trigger.event}</strong><span>{trigger.action.replaceAll("_", " ")}</span><small>{trigger.downstream.replaceAll("_", " ")}</small></div>)}</div></Panel>
    </div>
    <p className="panel-note"><strong>Privacy boundary:</strong> raw identity documents, NIN/BVN, biometrics and templates are not accepted by these case APIs or exported to the lakehouse. Customer KYC decisions belong to the vendor-regulated flow. Manual review and redress remain available; no fully automated rejection or model approval is implied.</p>
  </WorkspaceLayout>;
}
