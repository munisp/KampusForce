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
      setNotice(`${result.requestRef} added. You have 30 days to answer.`);
      refresh();
    },
  });
  const verifyDsar = trpc.ops.verifyDsar.useMutation({
    onSuccess: (result) => {
      setVerificationNote("");
      setNotice(`${result.requestRef} confirmed. You can now download their data.`);
      refresh();
    },
  });
  const reviewDsar = trpc.ops.reviewDsar.useMutation({
    onSuccess: (result) => { setNotice(`${result.requestRef} is under review.`); refresh(); },
  });
  const fulfilDsar = trpc.ops.fulfilDsar.useMutation({
    onSuccess: (result) => {
      setOutcomeNote("");
      setNotice(`${result.requestRef} marked done.`);
      refresh();
    },
  });
  const rejectDsar = trpc.ops.rejectDsar.useMutation({
    onSuccess: (result) => {
      setOutcomeNote("");
      setNotice(`${result.requestRef} refused.`);
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
      setNotice(`${result.fileName} downloaded.`);
      refresh();
    },
  });
  const createBreach = trpc.ops.createBreach.useMutation({
    onSuccess: (result) => {
      setBreachTitle("");
      setBreachSummary("");
      setAssessmentId(result.assessmentId);
      setQueue("breach");
      setNotice(`${result.assessmentRef} opened. You have 72 hours to assess it. Nobody has been notified.`);
      refresh();
    },
  });
  const startBreach = trpc.ops.startBreach.useMutation({
    onSuccess: (result) => { setNotice(`Incident #${result.assessmentId} is being assessed.`); refresh(); },
  });
  const decideBreach = trpc.ops.decideBreach.useMutation({
    onSuccess: (result) => {
      setDecisionNote("");
      setNotice(`Decision saved for incident #${result.assessmentId}. Any notification still has to be done by a person.`);
      refresh();
    },
  });
  const closeBreach = trpc.ops.closeBreach.useMutation({
    onSuccess: (result) => {
      setClosureNote("");
      setNotice(`Incident #${result.assessmentId} closed. This app didn't notify the regulator.`);
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
    <div className="trust-strip"><LockKeyhole size={18} /><span><strong>Privacy requests and data incidents.</strong> Confirm who a person is before exporting their data. This doesn't notify the NDPC for you, and it isn't legal advice.</span></div>
    <div className="metrics-grid">
      <Metric label="Open customer requests" value={data.metrics.openDsars} note="Answer within 30 days" tone={data.metrics.openDsars ? "mustard" : "default"} />
      <Metric label="Open data incidents" value={data.metrics.openBreaches} note="Assess within 72 hours" tone={data.metrics.openBreaches ? "mustard" : "default"} />
      <Metric label="Overdue" value={data.metrics.overduePrivacy} note="Past their deadline" tone={data.metrics.overduePrivacy ? "danger" : "default"} />
      <Metric label="Data downloads" value={data.dsarRequestEvents.filter((event) => event.action === "evidence_exported").length} note="Each one recorded" tone="teal" />
    </div>

    <div className="privacy-intake-grid">
      <Panel title="Add a customer request" action={<span className="result-count">Answer within 30 days</span>}>
        <form className="privacy-form" onSubmit={submitDsar}>
          <label>Customer phone<small>We scramble this and don't save the number.</small><input type="tel" autoComplete="off" required value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="0801 234 5678" /></label>
          <label>Request type<select value={requestType} onChange={(event) => setRequestType(event.target.value as typeof requestType)}><option value="access">See my data</option><option value="rectification">Correct my data</option><option value="erasure">Delete my data</option><option value="objection">Stop using my data</option></select></label>
          <button className="button primary" type="submit" disabled={createDsar.isPending || customerPhone.trim().length < 10}><Plus size={15} />Add request</button>
        </form>
      </Panel>
      <Panel title="Report a data incident" action={<span className="result-count">Assess within 72 hours</span>}>
        <form className="privacy-form" onSubmit={submitBreach}>
          <label>Title<input required minLength={5} maxLength={180} value={breachTitle} onChange={(event) => setBreachTitle(event.target.value)} placeholder="Short title" /></label>
          <label>Summary<small>Describe what happened. Don't include customer data or passwords.</small><textarea required minLength={10} maxLength={2000} value={breachSummary} onChange={(event) => setBreachSummary(event.target.value)} placeholder="What's affected, and what's been done so far" /></label>
          <button className="button primary" type="submit" disabled={createBreach.isPending || breachTitle.trim().length < 5 || breachSummary.trim().length < 10}><ShieldAlert size={15} />Start</button>
        </form>
      </Panel>
    </div>

    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {actionError && <p className="form-error" role="alert">{actionError.message}</p>}
    <div className="workspace-tabs privacy-queue-tabs" role="tablist" aria-label="Privacy sections">
      <button className={queue === "dsar" ? "active" : ""} onClick={() => setQueue("dsar")}><FileJson size={16} />Customer requests <span>{data.metrics.openDsars}</span></button>
      <button className={queue === "breach" ? "active" : ""} onClick={() => setQueue("breach")}><ShieldAlert size={16} />Data incidents <span>{data.metrics.openBreaches}</span></button>
    </div>

    {queue === "dsar" && <>
      <Panel title="Customer requests" action={<span className="result-count">No customer details shown</span>}>
        {data.dsarRequests.length ? <div className="table-wrap"><table><thead><tr><th>Request</th><th>Type</th><th>Received</th><th>Response due</th><th>State</th><th></th></tr></thead><tbody>{data.dsarRequests.map((request) => {
          const overdue = request.overdue;
          return <tr key={request.id}><td><strong>{request.requestRef}</strong><small className="table-sub mono">{request.customerPhoneHash.slice(0, 12)}…</small></td><td>{request.requestType}</td><td>{shortDate(request.receivedAt)}</td><td>{shortDate(request.dueAt)}{overdue && <small className="table-sub overdue-text"><AlertTriangle size={12} />Overdue</small>}</td><td><StateBadge state={request.state} /></td><td><button className="button secondary small" onClick={() => selectRequest(request.id)}>Review</button></td></tr>;
        })}</tbody></table></div> : <EmptyState title="No customer requests" detail="Add a request above when a customer asks about their data." />}
      </Panel>
      {selectedRequest && <div className="case-workspace">
        <Panel title={selectedRequest.requestRef} className="case-detail" action={<StateBadge state={selectedRequest.state} />}>
          <div className="case-facts"><div><span>Request type</span><strong>{selectedRequest.requestType}</strong></div><div><span>Response due</span><strong>{shortDate(selectedRequest.dueAt)}</strong></div><div><span>Customer code</span><strong className="mono">{selectedRequest.customerPhoneHash.slice(0, 16)}…</strong></div><div><span>Handled by</span><strong>User #{selectedRequest.ownerUserId}</strong></div></div>
          <p className="case-description">The export only contains this customer's records, and leaves out support notes, ID details and other people's data.</p>
          {selectedRequest.state === "received" && <div className="resolution-form"><label>How you confirmed who they are<textarea minLength={10} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} placeholder="How did you confirm who they are? Don't include a NIN, BVN or ID document" /></label><button className="button primary" disabled={verificationNote.trim().length < 10 || verifyDsar.isPending} onClick={() => verifyDsar.mutate({ token, requestId: selectedRequest.id, verificationNote: verificationNote.trim() })}><UserCheck size={15} />Confirm who they are</button></div>}
          <div className="case-actions">
            {selectedRequest.state === "identity_verified" && <button className="button secondary" disabled={reviewDsar.isPending} onClick={() => reviewDsar.mutate({ token, requestId: selectedRequest.id })}><Play size={15} />Start review</button>}
            {["identity_verified", "in_review", "fulfilled"].includes(selectedRequest.state) && <button className="button secondary" disabled={exportDsar.isPending} onClick={() => exportDsar.mutate({ token, requestId: selectedRequest.id })}><Download size={15} />Download their data</button>}
          </div>
          {!["fulfilled", "rejected"].includes(selectedRequest.state) && <div className="resolution-form"><label>Result, or why you're refusing<textarea minLength={10} value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="What was the result?" /></label><div className="case-actions"><button className="button secondary" disabled={outcomeNote.trim().length < 10 || rejectDsar.isPending} onClick={() => rejectDsar.mutate({ token, requestId: selectedRequest.id, outcomeNote: outcomeNote.trim() })}><X size={15} />Refuse</button>{selectedRequest.state === "in_review" && <button className="button primary" disabled={outcomeNote.trim().length < 10 || fulfilDsar.isPending} onClick={() => fulfilDsar.mutate({ token, requestId: selectedRequest.id, outcomeNote: outcomeNote.trim() })}><Check size={15} />Mark done</button>}</div></div>}
          {selectedRequest.outcomeNote && <p className="panel-note"><strong>Result:</strong> {selectedRequest.outcomeNote}</p>}
        </Panel>
        <Panel title="What's happened" className="case-inbox"><div className="timeline">{requestHistory.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{shortDate(event.createdAt)} · Actor {event.actorUserId || "system"}</small><p>{event.note}</p></div></div>)}</div><p className="panel-note">We record that an export happened, but don't keep a copy.</p></Panel>
      </div>}
    </>}

    {queue === "breach" && <>
      <Panel title="Data incidents" action={<span className="result-count">Needs a decision and an owner</span>}>
        {data.breachAssessments.length ? <div className="table-wrap"><table><thead><tr><th>Incident</th><th>Detected</th><th>Assess by</th><th>Risk</th><th>Tell the regulator?</th><th>State</th><th></th></tr></thead><tbody>{data.breachAssessments.map((assessment) => {
          const overdue = assessment.overdue;
          return <tr key={assessment.id}><td><strong>{assessment.assessmentRef}</strong><small className="table-sub">{assessment.title}</small></td><td>{shortDate(assessment.detectedAt)}</td><td>{shortDate(assessment.triageDueAt)}{overdue && <small className="table-sub overdue-text"><AlertTriangle size={12} />Overdue</small>}</td><td>{assessment.risk || "Unrated"}</td><td>{assessment.notificationDecision.replaceAll("_", " ")}</td><td><StateBadge state={assessment.state} /></td><td><button className="button secondary small" onClick={() => selectAssessment(assessment.id)}>Review</button></td></tr>;
        })}</tbody></table></div> : <EmptyState title="No data incidents" detail="Report one above if customer data may have been exposed." />}
      </Panel>
      {selectedAssessment && <div className="case-workspace">
        <Panel title={selectedAssessment.title} className="case-detail" action={<StateBadge state={selectedAssessment.state} />}>
          <div className="case-facts"><div><span>Incident</span><strong>{selectedAssessment.assessmentRef}</strong></div><div><span>Assess by</span><strong>{shortDate(selectedAssessment.triageDueAt)}</strong></div><div><span>Risk</span><strong>{selectedAssessment.risk || "Unrated"}</strong></div><div><span>Tell the regulator?</span><strong>{selectedAssessment.notificationDecision.replaceAll("_", " ")}</strong></div></div>
          <p className="case-description">{selectedAssessment.summary}</p>
          {selectedAssessment.state === "reported" && <button className="button primary" disabled={startBreach.isPending} onClick={() => startBreach.mutate({ token, assessmentId: selectedAssessment.id })}><Play size={15} />Start assessing</button>}
          {selectedAssessment.state === "assessing" && <div className="resolution-form"><div className="privacy-decision-grid"><label>Risk<select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Do you need to notify?<select value={notificationDecision} onChange={(event) => setNotificationDecision(event.target.value as typeof notificationDecision)}><option value="required">Yes. The owner must do this outside this app</option><option value="not_required">No. Reason recorded</option></select></label><label>Owner<select required value={ownerId} onChange={(event) => setOwnerId(Number(event.target.value))}><option value={0}>Choose an owner</option>{data.privacyOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.role}</option>)}</select></label></div><label>Reason<textarea minLength={10} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Why this risk level, and who needs to be told?" /></label><button className="button primary" disabled={!ownerId || decisionNote.trim().length < 10 || decideBreach.isPending} onClick={() => decideBreach.mutate({ token, assessmentId: selectedAssessment.id, risk, notificationDecision, notificationOwnerUserId: ownerId, decisionNote: decisionNote.trim() })}><Check size={15} />Save decision</button></div>}
          {selectedAssessment.decisionNote && <p className="panel-note"><strong>Decision:</strong> {selectedAssessment.decisionNote}<br /><strong>Owner:</strong> {data.privacyOwners.find((owner) => owner.id === selectedAssessment.notificationOwnerUserId)?.name || `User #${selectedAssessment.notificationOwnerUserId}`}</p>}
          {selectedAssessment.state === "decision_recorded" && <div className="resolution-form"><label>How it ended<textarea minLength={10} value={closureNote} onChange={(event) => setClosureNote(event.target.value)} placeholder="What was done, and what's left to do?" /></label><button className="button primary" disabled={closureNote.trim().length < 10 || closeBreach.isPending} onClick={() => closeBreach.mutate({ token, assessmentId: selectedAssessment.id, closureNote: closureNote.trim() })}><Check size={15} />Close incident</button></div>}
          {selectedAssessment.closureNote && <p className="panel-note"><strong>Closed:</strong> {selectedAssessment.closureNote}</p>}
          <p className="panel-note"><strong>Regulator notified:</strong> Not by this app. It only records your decision, so someone must notify the NDPC or the people affected.</p>
        </Panel>
        <Panel title="What's happened" className="case-inbox"><div className="timeline">{breachHistory.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{shortDate(event.createdAt)} · Actor {event.actorUserId || "system"}</small><p>{event.note}</p></div></div>)}</div><p className="panel-note">This records decisions only. It doesn't prove anyone was notified.</p></Panel>
      </div>}
    </>}
  </>;
}
