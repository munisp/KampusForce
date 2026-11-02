import { useState } from "react";
import { ArrowRight, Check, FileScan, Fingerprint, KeyRound, RefreshCw, ShieldCheck, Store, UserCheck, Workflow } from "lucide-react";
import { EmptyState, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { fullDate, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { EnrollmentPanel } from "@/components/product/EnrollmentPanel";
import { DocumentPreview, DocumentUploads } from "@/components/product/IdentityDocuments";

const caseLabels: Record<string, string> = { representative_kyc: "Student rep ID check", campus_lead_kyc: "Campus lead ID check", vendor_kyb: "Business check", operations_kyc: "Staff ID check", customer_handoff: "Customer handoff" };
const evidenceLabels: Record<string, string> = { document_ocr: "Reading your ID document", document_structure: "Checking the document's layout", vlm_extraction: "Cross-checking the document's details", capture_integrity: "Checking the photo is genuine", liveness: "Confirming you're a live person", deepfake: "Checking for fake images", face_match: "Matching your face to your ID", bank_name_match: "Matching your bank account name", registry_kyb: "Checking the business registry", reviewer_attestation: "Staff declaration", manual_document_check: "The document is genuine, in date, and has the right name", manual_face_check: "The selfie shows the same person as the ID", manual_business_check: "The CAC certificate matches the business name and number" };
const nextStep: Record<string, string> = { draft: "Follow the three steps below.", submitted: "Operations has your request. You don't need to do anything for now.", processing: "Your checks are running. You don't need to do anything for now.", manual_review: "Operations is checking your documents. You'll get a notification when they decide.", needs_more_info: "Operations needs more from you. Read their note, upload what they asked for, then submit again.", approved: "You're approved.", rejected: "This check wasn't approved. Read the note above, or contact Operations.", revoked: "This check has stopped.", expired: "This check has expired. Start a new one to continue." };

const reviewerLabels: Record<string, string> = { government_id: "Government ID", selfie: "Selfie holding the ID", business_certificate: "CAC certificate", owner_id: "Owner's ID" };
const reviewChecks: Record<string, string> = { manual_document_check: "The document looks genuine, is in date, and has the right name", manual_face_check: "The selfie shows the same person as the ID", manual_business_check: "The CAC certificate matches the business name and number" };

export default function Identity() {
  const { token, user } = useWorkspace();
  const subtitle = user.role === "vendor" ? "Show your business is real so you can start selling." : user.role === "rep" ? "Show who you are so you can earn and get paid." : "Review ID and business checks.";
  const utils = trpc.useUtils();
  const overview = trpc.identity.overview.useQuery({ token });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queue, setQueue] = useState<"review" | "waiting" | "decided">("review");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const refresh = (message: string) => { setNotice(message); setReason(""); setConfirmed([]); utils.identity.overview.invalidate(); };
  const openCase = trpc.identity.openCase.useMutation({ onSuccess: (result) => { setSelectedId(result.identityCase.id); refresh("Your check is ready. Follow the steps below."); } });
  const consent = trpc.identity.consent.useMutation({ onSuccess: () => refresh("Thanks, that's recorded.") });
  const submit = trpc.identity.submit.useMutation({ onSuccess: () => refresh(`Submitted. Operations will review it and you'll get a notification.`) });
  const processSandbox = trpc.identity.processSandbox.useMutation({ onSuccess: (result) => refresh(`${result.caseRef} is ready for your review.`) });
  const review = trpc.identity.review.useMutation({ onSuccess: () => { setSelectedId(null); refresh("Decision saved."); } });
  const reverify = trpc.identity.reverify.useMutation({ onSuccess: () => refresh(`Your renewal check is open.`) });
  const handoff = trpc.identity.customerHandoff.useMutation({ onSuccess: () => refresh("Recorded. Customers verify their identity on your own service.") });
  const withdraw = trpc.identity.withdrawConsent.useMutation({ onSuccess: () => refresh(`You've withdrawn your consent, and this check has stopped.`) });
  if (overview.isLoading) return <WorkspaceLayout title="Verification" subtitle={subtitle}><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Verification" subtitle={subtitle}><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  const inQueue = (item: typeof data.cases[number]) => (["manual_review", "submitted", "processing"].includes(item.state) ? "review" : ["draft", "needs_more_info"].includes(item.state) ? "waiting" : "decided") === queue;
  const queued = data.cases.filter(inQueue).sort((a, b) => new Date(a.reviewDueAt || 0).getTime() - new Date(b.reviewDueAt || 0).getTime());
  const selected = data.cases.find((item) => item.id === selectedId) || (["ops", "admin", "finance"].includes(user.role) ? (queue === "review" ? queued[0] : data.cases.find(inQueue)) : data.cases.find((item) => ["draft", "needs_more_info", "manual_review", "submitted", "processing"].includes(item.state)) || data.cases[0]) || null;
  const privileged = ["ops", "admin"].includes(user.role);
  const staff = privileged || user.role === "finance";
  const hasOpenCase = data.cases.some((item) => item.subjectType === "user" ? item.subjectId === user.id && !["rejected", "revoked", "expired"].includes(item.state) : !["rejected", "revoked", "expired"].includes(item.state));
  const ownCase = !!selected && selected.subjectType === "user" && selected.subjectId === user.id;
  const applicantControls = !privileged || ownCase;
  const reviewerControls = privileged && !ownCase;
  const actionError = openCase.error || consent.error || submit.error || processSandbox.error || review.error || reverify.error || handoff.error || withdraw.error;
  const caseType: "representative_kyc" | "vendor_kyb" = user.role === "vendor" ? "vendor_kyb" : "representative_kyc";
  const ownConsents = selected ? data.consents.filter((item) => item.caseId === selected.id && !item.withdrawnAt) : [];
  const selectedEvidence = selected ? data.evidence.filter((item) => item.caseId === selected.id) : [];
  const selectedDocuments = selected ? data.documents.filter((item) => item.caseId === selected.id) : [];
  const manualCase = selected?.reviewMethod === "manual";
  const consented = ownConsents.length >= 2;
  const allUploaded = !!selected && selected.requiredDocuments.every((kind) => selectedDocuments.some((document) => document.kind === kind));
  const queueOf = (state: string) => (["manual_review", "submitted", "processing"].includes(state) ? "review" : ["draft", "needs_more_info"].includes(state) ? "waiting" : "decided");
  const queueCases = { review: data.cases.filter((item) => queueOf(item.state) === "review").sort((a, b) => new Date(a.reviewDueAt || 0).getTime() - new Date(b.reviewDueAt || 0).getTime()), waiting: data.cases.filter((item) => queueOf(item.state) === "waiting"), decided: data.cases.filter((item) => queueOf(item.state) === "decided") };
  const typeLabel = (type: string) => caseLabels[type] || type.replaceAll("_", " ");
  const person = (item: typeof data.cases[number]) => item.subject?.companyName || item.subject?.name || typeLabel(item.caseType);
  const overdue = (item: typeof data.cases[number]) => queueOf(item.state) === "review" && !!item.reviewDueAt && new Date(item.reviewDueAt).getTime() < overview.dataUpdatedAt;

  if (staff) return <WorkspaceLayout title="ID checks" subtitle={subtitle}>
    {!data.readiness.liveEligible && <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>Checks are done by hand.</strong> You look at each document and decide. Nothing here is checked against government records, so you can't confirm a NIN or BVN is real.</p></div>}
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    <div className="workspace-tabs" role="tablist" aria-label="Check queues">
      {([["review", "To review"], ["waiting", "Waiting on applicant"], ["decided", "Decided"]] as const).map(([key, label]) => <button key={key} className={queue === key ? "active" : ""} onClick={() => { setQueue(key); setSelectedId(null); setReason(""); setConfirmed([]); }}>{label} <span>{queueCases[key].length}</span></button>)}
    </div>
    <div className={`identity-layout${queueCases[queue].length ? "" : " identity-layout-empty"}`}>
      <div className="identity-queue">
        {queueCases[queue].length ? <div className="identity-case-list">{queueCases[queue].map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setReason(""); setConfirmed([]); }}><span><strong>{person(item)}</strong><small>{typeLabel(item.caseType)}</small><small className={overdue(item) ? "identity-overdue" : ""}>{queueOf(item.state) === "review" && item.reviewDueAt ? `${overdue(item) ? "Overdue" : "Due"} ${shortDate(item.reviewDueAt)}` : item.caseRef}</small></span>{queue !== "review" && <StateBadge state={item.state} />}</button>)}</div> : <EmptyState title={queue === "review" ? "Nothing to review" : queue === "waiting" ? "Nobody to wait for" : "Nothing decided yet"} detail={queue === "review" ? "New checks appear here when someone submits their documents." : "Checks will appear here."} />}
      </div>
      <div className="identity-case">
        {selected ? <Panel title={person(selected)} action={<StateBadge state={selected.state} />}>
          <div className="identity-detail">
            <div className="identity-case-summary">
              <div><span>Check</span><strong>{typeLabel(selected.caseType)}</strong></div>
              {selected.subject?.companyName && <div><span>Owner</span><strong>{selected.subject.name}</strong></div>}
              {selected.subject?.cacNumber && <div><span>CAC number</span><strong>{selected.subject.cacNumber}</strong></div>}
              {selected.subject?.email && <div><span>Email</span><strong>{selected.subject.email}</strong></div>}
              <div><span>Reference</span><strong>{selected.caseRef}</strong></div>
              {queueOf(selected.state) === "review" && <div><span>Review by</span><strong className={overdue(selected) ? "identity-overdue" : ""}>{selected.reviewDueAt ? shortDate(selected.reviewDueAt) : "—"}</strong></div>}
              {selected.validUntil && <div><span>Valid until</span><strong>{fullDate(selected.validUntil)}</strong></div>}
            </div>
            {selected.decisionReason && <p className="panel-note"><strong>Latest decision:</strong> {selected.decisionReason}</p>}
            {queueOf(selected.state) === "waiting" && <p className="panel-note">{selected.state === "draft" ? "They haven't submitted their documents yet." : "You asked for more. It comes back to To review when they resubmit."}</p>}
            {reviewerControls && manualCase && selected.state === "manual_review" && <>
              <div className="identity-document-grid">{selectedDocuments.map((document) => <div key={document.id} className="identity-document-card"><h3>{reviewerLabels[document.kind] || document.kind}</h3><DocumentPreview documentId={document.id} label={reviewerLabels[document.kind] || "document"} /></div>)}</div>
              <div className="identity-decision">
                <div className="identity-checklist"><strong>Confirm before approving</strong>{selected.requiredEvidence.map((kind) => <label key={kind}><input type="checkbox" data-check={kind} checked={confirmed.includes(kind)} onChange={(event) => setConfirmed(event.target.checked ? [...confirmed, kind] : confirmed.filter((item) => item !== kind))} />{reviewChecks[kind] || kind}</label>)}</div>
                <label htmlFor="identity-review-reason"><strong>Reason</strong> <small>Needed to reject or ask for more. The applicant sees it.</small></label>
                <textarea id="identity-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="e.g. The photo of the ID is too blurry to read" />
                <div className="identity-actions"><button className="button small" disabled={review.isPending || selected.requiredEvidence.some((kind) => !confirmed.includes(kind))} onClick={() => review.mutate({ token, caseId: selected.id, decision: "approve", reason: reason.trim().length >= 10 ? reason : "Documents checked and approved.", confirmedChecks: confirmed })}>Approve</button><button className="button secondary small" disabled={review.isPending || reason.trim().length < 10} onClick={() => review.mutate({ token, caseId: selected.id, decision: "request_info", reason })}>Ask for more information</button><button className="button danger small" disabled={review.isPending || reason.trim().length < 10} onClick={() => review.mutate({ token, caseId: selected.id, decision: "reject", reason })}>Reject</button></div>
              </div>
            </>}
            {reviewerControls && !manualCase && ["submitted", "processing", "needs_more_info"].includes(selected.state) && <button className="button secondary small" disabled={processSandbox.isPending} onClick={() => processSandbox.mutate({ token, caseId: selected.id })}><Workflow size={14} />Run test checks</button>}
            {reviewerControls && !manualCase && selected.state === "manual_review" && <div className="identity-review"><label htmlFor="identity-review-reason">Reason for your decision</label><textarea id="identity-review-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /><div className="identity-actions"><button className="button small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "approve", reason })}>Approve</button><button className="button secondary small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "request_info", reason })}>Ask for more information</button><button className="button danger small" disabled={review.isPending} onClick={() => review.mutate({ token, caseId: selected.id, decision: "reject", reason })}>Reject</button></div></div>}
          </div>
        </Panel> : null}
      </div>
    </div>
    <details className="developer-details"><summary>Technical details</summary>
      <div className="architecture-analytics-grid identity-grid">
        {selected && <Panel title="Check results" action={<FileScan size={18} />}>
          <div className="identity-case-summary"><div><span>Policy</span><strong>{selected.policyVersion}</strong></div><div><span>Mode</span><strong>{selected.providerMode === "sandbox" ? "test" : selected.providerMode}</strong></div><div><span>Reviewed by</span><strong>{selected.reviewMethod === "manual" ? "a person" : "test data"}</strong></div></div>
          {selectedEvidence.length ? <div className="table-wrap"><table><thead><tr><th>Check</th><th>Service</th><th>Score</th><th>State</th></tr></thead><tbody>{selectedEvidence.map((item) => <tr key={item.id}><td><strong>{evidenceLabels[item.kind] || item.kind.replaceAll("_", " ")}</strong></td><td>{item.provider}<small className="table-subtitle">{item.modelVersion || "version unavailable"}</small></td><td>{item.score === null ? "—" : Number(item.score).toFixed(3)}</td><td><StateBadge state={item.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No results yet" detail="Results will appear here after the checks run." />}
        </Panel>}
        <Panel title="What's needed before real ID checks" action={<ShieldCheck size={18} />}><div className="readiness-checks">{data.readiness.checks.map((check) => <div key={check.key}><span>{check.ready ? <Check size={14} /> : <KeyRound size={14} />}</span><p><strong>{check.key.replaceAll("_", " ")}</strong><small>{check.detail}</small></p><StateBadge state={check.ready ? "verified" : "blocked"} /></div>)}</div></Panel>
        <Panel title="What starts a check" action={<Workflow size={18} />}><div className="identity-trigger-list">{data.triggers.map((trigger) => <div key={`${trigger.event}-${trigger.caseType}`}><strong>{trigger.event}</strong><span>{trigger.action.replaceAll("_", " ")}</span><small>{trigger.downstream.replaceAll("_", " ")}</small></div>)}</div></Panel>
      </div>
    </details>
  </WorkspaceLayout>;

  const openHere = selected && ["draft", "needs_more_info"].includes(selected.state);
  return <WorkspaceLayout title="Verification" subtitle={subtitle}>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    {!hasOpenCase && <Panel title={user.role === "vendor" ? "Verify your business" : "Verify your identity"}>
      <p className="panel-note">{user.role === "vendor" ? "You'll need your CAC certificate and the owner's government ID." : "You'll need a government ID and a selfie holding it."} It takes a couple of minutes.</p>
      <button className="button primary" disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType })}>{user.role === "vendor" ? <Store size={15} /> : <UserCheck size={15} />}{user.role === "vendor" ? "Start my business check" : "Start my ID check"}</button>
    </Panel>}
    {selected && <Panel title={typeLabel(selected.caseType)} action={<StateBadge state={selected.state} />}>
      <div className="identity-detail">
        {nextStep[selected.state] && <p className={`identity-next identity-next-${selected.state}`}>{nextStep[selected.state]}</p>}
        {selected.decisionReason && <p className="panel-note"><strong>From Operations:</strong> {selected.decisionReason}</p>}
        {selected.validUntil && <p className="panel-note"><strong>Valid until:</strong> {fullDate(selected.validUntil)}</p>}
        {openHere && manualCase && <ol className="identity-stepper">
          <li className={consented ? "done" : "current"}><h3>Agree to the check</h3><p>Operations staff will look at your documents to confirm who you are. Your files are encrypted, every view is recorded, and they're deleted 30 days after a decision.</p>{consented ? <span className="identity-upload-state"><Check size={14} />Agreed</span> : <button className="button secondary small" disabled={consent.isPending} onClick={async () => { await consent.mutateAsync({ token, caseId: selected.id, purpose: "identity_verification", noticeAcknowledged: true }); await consent.mutateAsync({ token, caseId: selected.id, purpose: "biometric_liveness", noticeAcknowledged: true }); }}><Check size={14} />I agree</button>}</li>
          <li className={!consented ? "" : allUploaded ? "done" : "current"}><h3>Upload your documents</h3><DocumentUploads caseId={selected.id} kinds={selected.requiredDocuments} documents={selectedDocuments} disabled={!consented} onChange={() => refresh("Uploaded.")} /></li>
          <li className={consented && allUploaded ? "current" : ""}><h3>Send for review</h3><p>Operations usually decides within a day, and you'll get a notification.</p><button className="button small" disabled={submit.isPending || !consented || !allUploaded} onClick={() => submit.mutate({ token, caseId: selected.id })}>Submit</button></li>
        </ol>}
        {applicantControls && !manualCase && ["draft", "needs_more_info"].includes(selected.state) && <div className="identity-actions"><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "identity_verification")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "identity_verification", noticeAcknowledged: true })}><FileScan size={14} />I agree to the ID check</button><button className="button secondary small" disabled={consent.isPending || ownConsents.some((item) => item.purpose === "biometric_liveness")} onClick={() => consent.mutate({ token, caseId: selected.id, purpose: "biometric_liveness", noticeAcknowledged: true })}><Fingerprint size={14} />I agree to the selfie check</button><button className="button small" disabled={submit.isPending || ownConsents.length < 2} onClick={() => submit.mutate({ token, caseId: selected.id })}>Submit<ArrowRight size={14} /></button></div>}
        {applicantControls && <div className="identity-actions">{selected.reverificationDue && <button className="button secondary small" disabled={reverify.isPending} onClick={() => reverify.mutate({ token, caseId: selected.id })}><RefreshCw size={14} />Renew my check</button>}{ownConsents.length > 0 && !["revoked", "expired", "rejected"].includes(selected.state) && <button className="button danger small" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ token, caseId: selected.id })}>Withdraw consent and stop</button>}</div>}
      </div>
    </Panel>}
    {user.role === "rep" && <EnrollmentPanel />}
    {data.cases.length > 1 && <Panel title="Your checks"><div className="identity-case-list">{data.cases.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><strong>{typeLabel(item.caseType)}</strong><small>{item.caseRef}</small></span><StateBadge state={item.state} /></button>)}</div></Panel>}
    <details className="developer-details"><summary>Other options</summary>
      <div className="identity-actions">
        {user.role === "rep" && <button className="button secondary small" disabled={openCase.isPending} onClick={() => openCase.mutate({ token, caseType: "campus_lead_kyc" })}><ShieldCheck size={15} />Start a campus lead check</button>}
        {user.role === "vendor" && <button className="button secondary small" disabled={handoff.isPending} onClick={() => handoff.mutate({ token })}><ArrowRight size={14} />Record that customers verify on our service</button>}
      </div>
    </details>
    <p className="panel-note"><strong>Your privacy:</strong> your documents are encrypted, only Operations can open them, and every view is recorded. They're deleted 30 days after a decision, or straight away if you withdraw consent. A person always makes the final decision, and you can challenge it. Customers verify their identity with the vendor.</p>
  </WorkspaceLayout>;
}
