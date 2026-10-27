import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Clock3, Download, FileJson, LockKeyhole, Play, Plus, ShieldAlert, UserCheck, X } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type Queue = "dsar" | "breach";

export function PrivacyDesk() {
  const { token } = useWorkspace();
  const overview = trpc.ops.overview.useQuery({ token });
  const utils = trpc.useUtils();
  const [queue, setQueue] = useState<Queue>("dsar");
  const [notice, setNotice] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [requestType, setRequestType] = useState<"access" | "rectification" | "erasure" | "objection">("access");
  const [breachTitle, setBreachTitle] = useState("");
  const [breachSummary, setBreachSummary] = useState("");
  const [requestId, setRequestId] = useState(0);
  const [assessmentId, setAssessmentId] = useState(0);
  const [verificationNote, setVerificationNote] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const [notificationDecision, setNotificationDecision] = useState<"not_required" | "required">("required");
  const [ownerId, setOwnerId] = useState(0);
  const [decisionNote, setDecisionNote] = useState("");
  const [closureNote, setClosureNote] = useState("");

  const refresh = () => {
    utils.ops.overview.invalidate();
    utils.notification.list.invalidate();
  };
  const createDsar = trpc.ops.createDsar.useMutation({
    onSuccess: (result) => {
      setCustomerPhone("");
      setRequestId(result.requestId);
      setQueue("dsar");
      setNotice(`${result.requestRef} registered with a 30-day response clock. The phone value was not persisted.`);
      refresh();
    },
  });
  const verifyDsar = trpc.ops.verifyDsar.useMutation({
    onSuccess: (result) => {
      setVerificationNote("");
      setNotice(`${result.requestRef} identity verification recorded. Evidence export is now available.`);
      refresh();
    },
  });
  const reviewDsar = trpc.ops.reviewDsar.useMutation({
    onSuccess: (result) => { setNotice(`${result.requestRef} moved into scoped record review.`); refresh(); },
  });
  const fulfilDsar = trpc.ops.fulfilDsar.useMutation({
    onSuccess: (result) => {
      setOutcomeNote("");
      setNotice(`${result.requestRef} fulfilled with its operational outcome preserved.`);
      refresh();
    },
  });
  const rejectDsar = trpc.ops.rejectDsar.useMutation({
    onSuccess: (result) => {
      setOutcomeNote("");
      setNotice(`${result.requestRef} rejected with the rationale preserved.`);
      refresh();
    },
  });
  const exportDsar = trpc.ops.exportDsar.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([JSON.stringify(result.evidence, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`${result.fileName} downloaded. The export event and record counts were audited.`);
      refresh();
    },
  });
  const createBreach = trpc.ops.createBreach.useMutation({
    onSuccess: (result) => {
      setBreachTitle("");
      setBreachSummary("");
      setAssessmentId(result.assessmentId);
      setQueue("breach");
      setNotice(`${result.assessmentRef} opened with a 72-hour triage clock. No external notification was sent.`);
      refresh();
    },
  });
  const startBreach = trpc.ops.startBreach.useMutation({
    onSuccess: (result) => { setNotice(`Breach assessment #${result.assessmentId} is under Operations triage.`); refresh(); },
  });
  const decideBreach = trpc.ops.decideBreach.useMutation({
    onSuccess: (result) => {
      setDecisionNote("");
      setNotice(`Breach decision recorded for assessment #${result.assessmentId}. External notification remains a human-owned action.`);
      refresh();
    },
  });
  const closeBreach = trpc.ops.closeBreach.useMutation({
    onSuccess: (result) => {
      setClosureNote("");
      setNotice(`Breach assessment #${result.assessmentId} closed without any sandbox regulator notification.`);
      refresh();
    },
  });

  const data = overview.data;
  const selectedRequest = useMemo(
    () => data?.dsarRequests.find((request) => request.id === requestId) || data?.dsarRequests[0],
    [data, requestId],
  );
  const selectedAssessment = useMemo(
    () => data?.breachAssessments.find((assessment) => assessment.id === assessmentId) || data?.breachAssessments[0],
    [data, assessmentId],
  );
  const actionError = createDsar.error || verifyDsar.error || reviewDsar.error || fulfilDsar.error || rejectDsar.error || exportDsar.error || createBreach.error || startBreach.error || decideBreach.error || closeBreach.error;

  if (overview.isLoading) return <Loading />;
  if (overview.error) return <ErrorState message={overview.error.message} retry={overview.refetch} />;
  if (!data) return null;

  const submitDsar = (event: FormEvent) => {
    event.preventDefault();
    createDsar.mutate({ token, customerPhone, requestType });
  };
  const submitBreach = (event: FormEvent) => {
    event.preventDefault();
    createBreach.mutate({ token, title: breachTitle.trim(), summary: breachSummary.trim() });
  };
  const selectRequest = (id: number) => {
    setRequestId(id);
    setVerificationNote("");
    setOutcomeNote("");
  };
  const selectAssessment = (id: number) => {
    setAssessmentId(id);
    setDecisionNote("");
    setClosureNote("");
  };
  const requestHistory = selectedRequest
    ? data.dsarRequestEvents.filter((event) => event.requestId === selectedRequest.id).sort((a, b) => a.id - b.id)
    : [];
  const breachHistory = selectedAssessment
    ? data.breachAssessmentEvents.filter((event) => event.assessmentId === selectedAssessment.id).sort((a, b) => a.id - b.id)
    : [];

  return <>
    <div className="trust-strip"><LockKeyhole size={18} /><span><strong>Privacy operations sandbox.</strong> DSAR and breach clocks are derived from durable records. Exports require identity verification. No NDPC notification, legal review or compliance certification is performed or implied.</span></div>
    <div className="metrics-grid">
      <Metric label="Open DSARs" value={data.metrics.openDsars} note="30-day response workflow" tone={data.metrics.openDsars ? "mustard" : "default"} />
      <Metric label="Open breach assessments" value={data.metrics.openBreaches} note="72-hour triage workflow" tone={data.metrics.openBreaches ? "mustard" : "default"} />
      <Metric label="Privacy deadlines overdue" value={data.metrics.overduePrivacy} note="Deduplicated incident signals" tone={data.metrics.overduePrivacy ? "danger" : "default"} />
      <Metric label="Evidence exports" value={data.dsarRequestEvents.filter((event) => event.action === "evidence_exported").length} note="Hash-scoped and audited" tone="teal" />
    </div>

    <div className="privacy-intake-grid">
      <Panel title="Register a DSAR" action={<span className="result-count">30-day response clock</span>}>
        <form className="privacy-form" onSubmit={submitDsar}>
          <label>Customer phone<small>Used once to calculate the salted hash; never stored on the request.</small><input type="tel" autoComplete="off" required value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="0801 234 5678" /></label>
          <label>Request type<select value={requestType} onChange={(event) => setRequestType(event.target.value as typeof requestType)}><option value="access">Access</option><option value="rectification">Rectification</option><option value="erasure">Erasure</option><option value="objection">Objection</option></select></label>
          <button className="button primary" type="submit" disabled={createDsar.isPending || customerPhone.trim().length < 10}><Plus size={15} />Register hashed request</button>
        </form>
      </Panel>
      <Panel title="Open a breach assessment" action={<span className="result-count">72-hour triage clock</span>}>
        <form className="privacy-form" onSubmit={submitBreach}>
          <label>Assessment title<input required minLength={5} maxLength={180} value={breachTitle} onChange={(event) => setBreachTitle(event.target.value)} placeholder="Short operational incident title" /></label>
          <label>Assessment summary<small>Describe the operational event; do not paste customer payloads or credentials.</small><textarea required minLength={10} maxLength={2000} value={breachSummary} onChange={(event) => setBreachSummary(event.target.value)} placeholder="Scope, systems involved and immediate containment context" /></label>
          <button className="button primary" type="submit" disabled={createBreach.isPending || breachTitle.trim().length < 5 || breachSummary.trim().length < 10}><ShieldAlert size={15} />Open assessment</button>
        </form>
      </Panel>
    </div>

    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    <div className="workspace-tabs privacy-queue-tabs" role="tablist" aria-label="Privacy case queues">
      <button className={queue === "dsar" ? "active" : ""} onClick={() => setQueue("dsar")}><FileJson size={16} />DSAR requests <span>{data.metrics.openDsars}</span></button>
      <button className={queue === "breach" ? "active" : ""} onClick={() => setQueue("breach")}><ShieldAlert size={16} />Breach assessments <span>{data.metrics.openBreaches}</span></button>
    </div>

    {queue === "dsar" && <>
      <Panel title="DSAR request queue" action={<span className="result-count">Hashed customer references only</span>}>
        {data.dsarRequests.length ? <div className="table-wrap"><table><thead><tr><th>Request</th><th>Type</th><th>Received</th><th>Response due</th><th>State</th><th></th></tr></thead><tbody>{data.dsarRequests.map((request) => {
          const overdue = request.overdue;
          return <tr key={request.id}><td><strong>{request.requestRef}</strong><small className="table-sub mono">{request.customerPhoneHash.slice(0, 12)}…</small></td><td>{request.requestType}</td><td>{shortDate(request.receivedAt)}</td><td>{shortDate(request.dueAt)}{overdue && <small className="table-sub overdue-text"><AlertTriangle size={12} />Overdue</small>}</td><td><StateBadge state={request.state} /></td><td><button className="button secondary small" onClick={() => selectRequest(request.id)}>Review</button></td></tr>;
        })}</tbody></table></div> : <EmptyState title="No DSAR requests" detail="Register a customer request above to start the 30-day Operations workflow." />}
      </Panel>
      {selectedRequest && <div className="case-workspace">
        <Panel title={selectedRequest.requestRef} className="case-detail" action={<StateBadge state={selectedRequest.state} />}>
          <div className="case-facts"><div><span>Request type</span><strong>{selectedRequest.requestType}</strong></div><div><span>Response due</span><strong>{shortDate(selectedRequest.dueAt)}</strong></div><div><span>Customer reference</span><strong className="mono">{selectedRequest.customerPhoneHash.slice(0, 16)}…</strong></div><div><span>Operations owner</span><strong>User #{selectedRequest.ownerUserId}</strong></div></div>
          <p className="case-description">Only records matching this salted customer hash enter the evidence package. Support free text, raw identity values, access tokens and unrelated representative or financial data are excluded.</p>
          {selectedRequest.state === "received" && <div className="resolution-form"><label>Identity verification note<textarea minLength={10} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder="Record the authorized evidence reviewed; do not paste NIN, BVN or identity documents" /></label><button className="button primary" disabled={verificationNote.trim().length < 10 || verifyDsar.isPending} onClick={() => verifyDsar.mutate({ token, requestId: selectedRequest.id, verificationNote: verificationNote.trim() })}><UserCheck size={15} />Verify requester identity</button></div>}
          <div className="case-actions">
            {selectedRequest.state === "identity_verified" && <button className="button secondary" disabled={reviewDsar.isPending} onClick={() => reviewDsar.mutate({ token, requestId: selectedRequest.id })}><Play size={15} />Start record review</button>}
            {["identity_verified", "in_review", "fulfilled"].includes(selectedRequest.state) && <button className="button secondary" disabled={exportDsar.isPending} onClick={() => exportDsar.mutate({ token, requestId: selectedRequest.id })}><Download size={15} />Export privacy-safe JSON</button>}
          </div>
          {!["fulfilled", "rejected"].includes(selectedRequest.state) && <div className="resolution-form"><label>Outcome or rejection rationale<textarea minLength={10} value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Record the operational outcome and evidence reviewed" /></label><div className="case-actions"><button className="button secondary" disabled={outcomeNote.trim().length < 10 || rejectDsar.isPending} onClick={() => rejectDsar.mutate({ token, requestId: selectedRequest.id, outcomeNote: outcomeNote.trim() })}><X size={15} />Reject request</button>{selectedRequest.state === "in_review" && <button className="button primary" disabled={outcomeNote.trim().length < 10 || fulfilDsar.isPending} onClick={() => fulfilDsar.mutate({ token, requestId: selectedRequest.id, outcomeNote: outcomeNote.trim() })}><Check size={15} />Mark fulfilled</button>}</div></div>}
          {selectedRequest.outcomeNote && <p className="panel-note"><strong>Recorded outcome:</strong> {selectedRequest.outcomeNote}</p>}
        </Panel>
        <Panel title="Append-only DSAR history" className="case-inbox"><div className="timeline">{requestHistory.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{shortDate(event.createdAt)} · Actor {event.actorUserId || "system"}</small><p>{event.note}</p></div></div>)}</div><p className="panel-note">Export history stores counts and timestamps, not another copy of customer evidence.</p></Panel>
      </div>}
    </>}

    {queue === "breach" && <>
      <Panel title="Breach assessment queue" action={<span className="result-count">Decision and ownership required</span>}>
        {data.breachAssessments.length ? <div className="table-wrap"><table><thead><tr><th>Assessment</th><th>Detected</th><th>Triage due</th><th>Risk</th><th>Notification</th><th>State</th><th></th></tr></thead><tbody>{data.breachAssessments.map((assessment) => {
          const overdue = assessment.overdue;
          return <tr key={assessment.id}><td><strong>{assessment.assessmentRef}</strong><small className="table-sub">{assessment.title}</small></td><td>{shortDate(assessment.detectedAt)}</td><td>{shortDate(assessment.triageDueAt)}{overdue && <small className="table-sub overdue-text"><AlertTriangle size={12} />Overdue</small>}</td><td>{assessment.risk || "Unrated"}</td><td>{assessment.notificationDecision.replaceAll("_", " ")}</td><td><StateBadge state={assessment.state} /></td><td><button className="button secondary small" onClick={() => selectAssessment(assessment.id)}>Review</button></td></tr>;
        })}</tbody></table></div> : <EmptyState title="No breach assessments" detail="Open an assessment above to start the 72-hour triage workflow." />}
      </Panel>
      {selectedAssessment && <div className="case-workspace">
        <Panel title={selectedAssessment.title} className="case-detail" action={<StateBadge state={selectedAssessment.state} />}>
          <div className="case-facts"><div><span>Assessment</span><strong>{selectedAssessment.assessmentRef}</strong></div><div><span>Triage due</span><strong>{shortDate(selectedAssessment.triageDueAt)}</strong></div><div><span>Risk</span><strong>{selectedAssessment.risk || "Unrated"}</strong></div><div><span>Notification</span><strong>{selectedAssessment.notificationDecision.replaceAll("_", " ")}</strong></div></div>
          <p className="case-description">{selectedAssessment.summary}</p>
          {selectedAssessment.state === "reported" && <button className="button primary" disabled={startBreach.isPending} onClick={() => startBreach.mutate({ token, assessmentId: selectedAssessment.id })}><Play size={15} />Start 72-hour assessment</button>}
          {selectedAssessment.state === "assessing" && <div className="resolution-form"><div className="privacy-decision-grid"><label>Risk rating<select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Notification decision<select value={notificationDecision} onChange={(event) => setNotificationDecision(event.target.value as typeof notificationDecision)}><option value="required">Required — owner must act externally</option><option value="not_required">Not required — rationale recorded</option></select></label><label>Accountable owner<select required value={ownerId} onChange={(event) => setOwnerId(Number(event.target.value))}><option value={0}>Select Operations or Admin owner</option>{data.privacyOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.role}</option>)}</select></label></div><label>Decision rationale<textarea minLength={10} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Record risk reasoning, evidence reviewed and notification-handling instructions" /></label><button className="button primary" disabled={!ownerId || decisionNote.trim().length < 10 || decideBreach.isPending} onClick={() => decideBreach.mutate({ token, assessmentId: selectedAssessment.id, risk, notificationDecision, notificationOwnerUserId: ownerId, decisionNote: decisionNote.trim() })}><Check size={15} />Record decision and owner</button></div>}
          {selectedAssessment.decisionNote && <p className="panel-note"><strong>Decision:</strong> {selectedAssessment.decisionNote}<br /><strong>Notification owner:</strong> {data.privacyOwners.find((owner) => owner.id === selectedAssessment.notificationOwnerUserId)?.name || `User #${selectedAssessment.notificationOwnerUserId}`}</p>}
          {selectedAssessment.state === "decision_recorded" && <div className="resolution-form"><label>Closure note<textarea minLength={10} value={closureNote} onChange={(event) => setClosureNote(event.target.value)} placeholder="Record containment, handoff and remaining external actions" /></label><button className="button primary" disabled={closureNote.trim().length < 10 || closeBreach.isPending} onClick={() => closeBreach.mutate({ token, assessmentId: selectedAssessment.id, closureNote: closureNote.trim() })}><Check size={15} />Close assessment</button></div>}
          {selectedAssessment.closureNote && <p className="panel-note"><strong>Closure:</strong> {selectedAssessment.closureNote}</p>}
          <p className="panel-note"><strong>External notification sent:</strong> No. This sandbox records decisions and ownership only; it does not contact the NDPC or data subjects.</p>
        </Panel>
        <Panel title="Append-only breach history" className="case-inbox"><div className="timeline">{breachHistory.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{shortDate(event.createdAt)} · Actor {event.actorUserId || "system"}</small><p>{event.note}</p></div></div>)}</div><p className="panel-note">Decision events retain risk and ownership metadata. They are not evidence of legal review or external delivery.</p></Panel>
      </div>}
    </>}
  </>;
}
