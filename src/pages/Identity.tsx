import { useState } from "react";
import { ArrowRight, Check, ClipboardCheck, FileScan, Fingerprint, KeyRound, RefreshCw, ShieldCheck, Store, UserCheck, Workflow } from "lucide-react";
import { EmptyState, Metric, Panel, useSystemStatus, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { EnrollmentPanel } from "@/components/product/EnrollmentPanel";

const caseLabels: Record<string, string> = { representative_kyc: "Student rep ID check", campus_lead_kyc: "Campus lead ID check", vendor_kyb: "Business check", operations_kyc: "Staff ID check", customer_handoff: "Customer handoff" };
const evidenceLabels: Record<string, string> = { document_ocr: "Reading your ID document", document_structure: "Checking the document's layout", vlm_extraction: "Cross-checking the document's details", capture_integrity: "Checking the photo is genuine", liveness: "Confirming you're a live person", deepfake: "Checking for fake images", face_match: "Matching your face to your ID", bank_name_match: "Matching your bank account name", registry_kyb: "Checking the business registry", reviewer_attestation: "Staff declaration" };
const nextStep: Record<string, string> = { draft: "Agree to both notices, then press Submit.", submitted: "Operations has your request. You don't need to do anything for now.", processing: "Your checks are running. You don't need to do anything for now.", manual_review: "Operations is reviewing your check. You'll get a notification when they decide.", needs_more_info: "Operations needs more from you. Read their note, then agree to both notices and submit again.", approved: "You're approved.", rejected: "This check wasn't approved. Read the note above, or contact Operations.", revoked: "This check has stopped.", expired: "This check has expired. Start a new one to continue." };

export default function Identity() {
  const { token, user } = useWorkspace();
  const system = useSystemStatus();
  const subtitle = user.role === "vendor" ? "Show your business is real so you can start selling." : user.role === "rep" ? "Show who you are so you can earn and get paid." : "Review ID and business checks.";
  const utils = trpc.useUtils();
  const overview = trpc.identity.overview.useQuery({ token });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState("I reviewed the results and agree with this decision.");
  const [notice, setNotice] = useState("");
  const refresh = (message: string) => { setNotice(message); utils.identity.overview.invalidate(); };
  const openCase = trpc.identity.openCase.useMutation({ onSuccess: (result) => refresh(`Your check is ready. Agree to both notices, then submit.`) });
  const consent = trpc.identity.consent.useMutation({ onSuccess: () => refresh("Thanks, that's recorded.") });
  const submit = trpc.identity.submit.useMutation({ onSuccess: (result) => refresh(`Submitted. Operations will review it and you'll get a notification.`) });
  const processSandbox = trpc.identity.processSandbox.useMutation({ onSuccess: (result) => refresh(`${result.caseRef} is ready for your review.`) });
  const review = trpc.identity.review.useMutation({ onSuccess: (result) => refresh(`${result.identityCase.caseRef} updated.`) });
  const reverify = trpc.identity.reverify.useMutation({ onSuccess: (result) => refresh(`Your renewal check is open.`) });
  const handoff = trpc.identity.customerHandoff.useMutation({ onSuccess: () => refresh("Recorded. Customers verify their identity on your own service.") });
  const withdraw = trpc.identity.withdrawConsent.useMutation({ onSuccess: (result) => refresh(`You've withdrawn your consent, and this check has stopped.`) });
  if (overview.isLoading) return <WorkspaceLayout title="Verification" subtitle={subtitle}><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Verification" subtitle={subtitle}><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  const selected = data.cases.find((item) => item.id === selectedId) || data.cases[0] || null;
  const privileged = ["ops", "admin"].includes(user.role);
  const staff = privileged || user.role === "finance";
  const hasOpenCase = data.cases.some((item) => item.subjectType === "user" ? item.subjectId === user.id && !["rejected", "revoked", "expired"].includes(item.state) : !["rejected", "revoked", "expired"].includes(item.state));
  const ownCase = !!selected && selected.subjectType === "user" && selected.subjectId === user.id;
  const applicantControls = !privileged || ownCase;
  const reviewerControls = privileged && !ownCase;
  const actionError = openCase.error || consent.error || submit.error || processSandbox.error || review.error || reverify.error || handoff.error || withdraw.error;
  const caseType: "representative_kyc" | "vendor_kyb" | "operations_kyc" = user.role === "vendor" ? "vendor_kyb" : user.role === "rep" ? "representative_kyc" : "operations_kyc";
  const ownConsents = selected ? data.consents.filter((item) => item.caseId === selected.id && !item.withdrawnAt) : [];
  const selectedEvidence = selected ? data.evidence.filter((item) => item.caseId === selected.id) : [];
  const pendingReview = data.cases.filter((item) => ["submitted", "processing", "manual_review", "needs_more_info"].includes(item.state)).length;
  const approved = data.cases.filter((item) => item.approvalValid).length;
  return <WorkspaceLayout title="Verification" subtitle={subtitle}>
    {!data.readiness.liveEligible && system.testMode && <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>Test mode.</strong> These checks don't verify a real ID yet. A person at Operations still reviews each one and decides.</p></div>}
    {staff && <div className="metrics-grid ops-metrics"><Metric label="Checks" value={data.cases.length} note={privileged ? "In your queue" : "Yours"} /><Metric label="Waiting for review" value={pendingReview} note="Not decided yet" tone={pendingReview ? "mustard" : "teal"} /><Metric label="Approved" value={approved} note="Still valid" /><Metric label="Real ID service" value={data.readiness.liveEligible ? "Eligible" : "Blocked"} note={`${data.readiness.checks.filter((check) => check.ready).length}/${data.readiness.checks.length} readiness checks`} tone={data.readiness.liveEligible ? "teal" : "danger"} /></div>}
    {user.role === "rep" && <EnrollmentPanel />}
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    <div className="architecture-toolbar"><div className="window-selector" aria-label="Start a check">
      {(staff || !hasOpenCase) && <button className={openCase.isPending ? "" : "active"} disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType })}>{user.role === "vendor" ? <Store size={15} /> : user.role === "rep" ? <UserCheck size={15} /> : <KeyRound size={15} />}{user.role === "vendor" ? "Start my business check" : user.role === "rep" ? "Start my ID check" : "Start my ID check"}</button>}
      {user.role === "rep" && <button disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType: "campus_lead_kyc" })}><ShieldCheck size={15} />Check for campus lead</button>}
    </div>{user.role === "vendor" && <button className="button secondary small" disabled={handoff.isPending} onClick={() => handoff.mutate({ token })}><ArrowRight size={14} />Customers verify on our service</button>}</div>
    <div className="architecture-analytics-grid identity-grid">
      <Panel title="Your checks" action={<ClipboardCheck size={18} />}>
        {data.cases.length ? <div className="identity-case-list">{data.cases.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><strong>{item.caseRef}</strong><small>{caseLabels[item.caseType] || item.caseType.replaceAll("_", " ")}</small></span><StateBadge state={item.state} /></button>)}</div> : <EmptyState title="No check started yet" detail="Press the button above to start." />}
      </Panel>
      <Panel title="Details" action={selected ? <StateBadge state={selected.state} /> : undefined}>
        {selected ? <div className="identity-detail">
          <div className="identity-case-summary">{staff && <div><span>Policy</span><strong>{selected.policyVersion}</strong></div>}{staff && <div><span>Mode</span><strong>{selected.providerMode}</strong></div>}<div><span>Review by</span><strong>{selected.reviewDueAt ? shortDate(selected.reviewDueAt) : "—"}</strong></div><div><span>Valid until</span><strong>{selected.validUntil ? shortDate(selected.validUntil) : "—"}</strong></div></div>
          {applicantControls && nextStep[selected.state] && <p className="panel-note"><strong>What happens next:</strong> {nextStep[selected.state]}</p>}{selected.decisionReason && <p className="panel-note"><strong>Latest decision:</strong> {selected.decisionReason}</p>}
          {applicantControls && ["draft", "needs_more_info"].includes(selected.state) && <div className="identity-actions"><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "identity_verification")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "identity_verification", noticeAcknowledged: true })}><FileScan size={14} />I agree to the ID check</button><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "biometric_liveness")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "biometric_liveness", noticeAcknowledged: true })}><Fingerprint size={14} />I agree to the selfie check</button><button className="button small" disabled={submit.isPending || ownConsents.length < 2} onClick={() => submit.mutate({ token, caseId: selected.id })}>Submit<ArrowRight size={14} /></button></div>}
          {reviewerControls && ["submitted", "processing", "needs_more_info"].includes(selected.state) && <button className="button secondary small" disabled={processSandbox.isPending} onClick={() => processSandbox.mutate({ token, caseId: selected.id })}><Workflow size={14} />Run test checks</button>}
          {reviewerControls && selected.state === "manual_review" && <div className="identity-review"><label htmlFor="identity-review-reason">Reason for your decision</label><textarea id="identity-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /><div className="identity-actions"><button className="button small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "approve", reason })}>Approve</button><button className="button secondary small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "request_info", reason })}>Ask for more information</button><button className="button danger small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "reject", reason })}>Reject</button></div></div>}
          {applicantControls && <div className="identity-actions">{selected.reverificationDue && <button className="button secondary small" disabled={reverify.isPending} onClick={() => reverify.mutate({ token, caseId: selected.id })}><RefreshCw size={14} />Renew my check</button>}{ownConsents.length > 0 && !["revoked", "expired", "rejected"].includes(selected.state) && <button className="button danger small" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ token, caseId: selected.id })}>Withdraw consent and stop</button>}</div>}
        </div> : <EmptyState title="Choose a check" detail="What you need to do will appear here." />}
      </Panel>
    </div>
    {selected && <div className="architecture-analytics-grid identity-grid">
      <Panel title="What's being checked" action={<span className="result-count">{selectedEvidence.length} done</span>}>
        <div className="readiness-checks">{selected.requiredEvidence.map((kind) => { const passed = selectedEvidence.some((item) => item.kind === kind && item.state === "passed"); return <div key={kind}><span>{passed ? <Check size={14} /> : <Fingerprint size={14} />}</span><p><strong>{evidenceLabels[kind] || kind.replaceAll("_", " ")}</strong><small>{passed ? "Passed" : "Not done yet"}</small></p><StateBadge state={passed ? "verified" : "pending"} /></div>; })}</div>
      </Panel>
      {staff && <Panel title="Check results" action={<FileScan size={18} />}>
        {selectedEvidence.length ? <div className="table-wrap"><table><thead><tr><th>Check</th><th>Service</th><th>Score</th><th>State</th></tr></thead><tbody>{selectedEvidence.map((item) => <tr key={item.id}><td><strong>{evidenceLabels[item.kind] || item.kind.replaceAll("_", " ")}</strong></td><td>{item.provider}<small className="table-subtitle">{item.modelVersion || "version unavailable"}</small></td><td>{item.score === null ? "—" : Number(item.score).toFixed(3)}</td><td><StateBadge state={item.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No results yet" detail="Results will appear here after the checks run." />}
      </Panel>}
    </div>}
    {staff && <div className="architecture-analytics-grid identity-grid">
      <Panel title="What's needed before real ID checks" action={<ShieldCheck size={18} />}><div className="readiness-checks">{data.readiness.checks.map((check) => <div key={check.key}><span>{check.ready ? <Check size={14} /> : <KeyRound size={14} />}</span><p><strong>{check.key.replaceAll("_", " ")}</strong><small>{check.detail}</small></p><StateBadge state={check.ready ? "verified" : "blocked"} /></div>)}</div></Panel>
      <Panel title="What starts a check" action={<Workflow size={18} />}><div className="identity-trigger-list">{data.triggers.map((trigger) => <div key={`${trigger.event}-${trigger.caseType}`}><strong>{trigger.event}</strong><span>{trigger.action.replaceAll("_", " ")}</span><small>{trigger.downstream.replaceAll("_", " ")}</small></div>)}</div></Panel>
    </div>}
    <p className="panel-note"><strong>Your privacy:</strong> we don't keep your ID documents, NIN, BVN or face data. A person always makes the final decision, and you can challenge it. Customers verify their identity with the vendor.</p>
  </WorkspaceLayout>;
}
