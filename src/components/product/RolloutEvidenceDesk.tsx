import { useMemo, useState } from "react";
import { Building2, CalendarCheck2, Check, ClipboardCheck, Database, FileCheck2, ShieldX, X } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type SubjectType = "campus_cohort" | "phase_quarter";

export function RolloutEvidenceDesk() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const readiness = trpc.ops.rolloutReadiness.useQuery({ token });
  const [subjectType, setSubjectType] = useState<SubjectType>("campus_cohort");
  const [subjectId, setSubjectId] = useState(0);
  const [metricKey, setMetricKey] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [periodStartDate, setPeriodStartDate] = useState("");
  const [periodEndDate, setPeriodEndDate] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [reviewReference, setReviewReference] = useState("");
  const [note, setNote] = useState("");
  const [realWorldAttested, setRealWorldAttested] = useState(false);
  const [realWorldReviewAttested, setRealWorldReviewAttested] = useState(false);
  const [evidenceId, setEvidenceId] = useState(0);
  const [notice, setNotice] = useState("");
  const [campusId, setCampusId] = useState(0);
  const [cohortLabel, setCohortLabel] = useState("October 2026 cohort");
  const [cohortStart, setCohortStart] = useState("2026-10-01");
  const [cohortEnd, setCohortEnd] = useState("2026-10-31");
  const [phase, setPhase] = useState(1);
  const [quarterLabel, setQuarterLabel] = useState("Q3 2026 phase gate");
  const [quarterStart, setQuarterStart] = useState("2026-07-01");
  const [quarterEnd, setQuarterEnd] = useState("2026-09-30");
  const refresh = () => utils.ops.rolloutReadiness.invalidate();
  const completed = (message: string) => ({ onSuccess: () => {
    setNotice(message);
    setEvidenceReference("");
    setReviewReference("");
    setNote("");
    setRealWorldAttested(false);
    setRealWorldReviewAttested(false);
    setEvidenceId(0);
    refresh();
  } });
  const createCohort = trpc.ops.createCampusCohort.useMutation({ onSuccess: (row) => { setNotice(`Campus cohort #${row.id} created. `); chooseSubject("campus_cohort", row.id); refresh(); } });
  const createQuarter = trpc.ops.createRolloutQuarter.useMutation({ onSuccess: (row) => { setNotice(`Phase ${row.phase} quarter #${row.id} created. `); chooseSubject("phase_quarter", row.id); refresh(); } });
  const submit = trpc.ops.submitRolloutEvidence.useMutation(completed("External evidence submitted for independent review. No campus or national launch state changed."));
  const review = trpc.ops.reviewRolloutEvidence.useMutation(completed("Independent evidence decision recorded with append-only history."));
  const snapshot = trpc.ops.captureRolloutSnapshot.useMutation({ onSuccess: (result) => { setNotice(`${result.evidenceIds.length} system snapshots recorded. They don't count as real-world proof.`); refresh(); } });
  const error = createCohort.error || createQuarter.error || submit.error || review.error || snapshot.error;

  const subjects = useMemo(() => subjectType === "campus_cohort" ? readiness.data?.cohorts || [] : readiness.data?.quarters || [], [readiness.data, subjectType]);
  const selected = subjects.find((row) => row.id === subjectId) || subjects[0];
  const selectedEvidence = readiness.data?.evidence.find((row) => row.id === evidenceId);
  const selectedMetric = selected?.evaluation.checks.some((check) => check.key === metricKey) ? metricKey : selected?.evaluation.checks[0]?.key || "";
  const selectedPeriodStart = periodStartDate || (selected ? ("cohortStartDate" in selected ? selected.cohortStartDate : selected.quarterStartDate) : "");
  const selectedPeriodEnd = periodEndDate || (selected ? ("monthOneEndDate" in selected ? selected.monthOneEndDate : selected.quarterEndDate) : "");
  const chooseSubject = (type: SubjectType, id: number) => {
    setSubjectType(type);
    setSubjectId(id);
    setMetricKey("");
    setPeriodStartDate("");
    setPeriodEndDate("");
  };

  if (readiness.isLoading) return <Loading />;
  if (readiness.error) return <ErrorState message={readiness.error.message} retry={readiness.refetch} />;
  const data = readiness.data!;
  const formatValue = (value: number | null, unit: string) => value === null ? "—" : unit === "percent" ? `${value.toLocaleString("en-NG")}%` : unit === "naira" ? `₦${value.toLocaleString("en-NG")}` : unit === "kobo" ? `₦${(value / 100).toLocaleString("en-NG")}` : unit === "months" ? `${value} months` : value.toLocaleString("en-NG");
  return <>
    <div className="trust-strip"><ClipboardCheck size={18} /><span><strong>Proof from real launches.</strong> System snapshots are operational context only. Only the latest external submission with a real-world attestation and independent approval can satisfy a metric; this desk never marks a campus live or certifies a national launch.</span></div>
    <div className="metrics-grid">
      <Metric label="Campus months" value={data.summary.campusCohorts} note={`${data.summary.campusEvidenceComplete} evidence-complete`} />
      <Metric label="Quarters" value={data.summary.phaseQuarters} note={`${data.summary.phaseEvidenceComplete} evidence-complete`} tone="teal" />
      <Metric label="From this app" value="Ineligible" note="Test data doesn't count" tone="mustard" />
      <Metric label="National launch" value="Not certified" note="Decided outside this app" />
    </div>
    <div className="sandbox-banner"><ShieldX size={18} /><p><strong>{data.summary.boundary}</strong></p></div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {error && <p className="form-error" role="alert">{error.message}</p>}

    <div className="rollout-grid">
      <Panel title="Add a campus's first month" action={<Building2 size={18} />}>
        <div className="resolution-form">
          <label>Campus<select value={campusId || data.campuses[0]?.id || 0} onChange={(event) => setCampusId(Number(event.target.value))}>{data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
          <label>Name<input value={cohortLabel} onChange={(event) => setCohortLabel(event.target.value)} /></label>
          <div className="form-row"><label>Month start<input type="date" value={cohortStart} onChange={(event) => setCohortStart(event.target.value)} /></label><label>Month end<input type="date" value={cohortEnd} onChange={(event) => setCohortEnd(event.target.value)} /></label></div>
          <button className="button secondary" disabled={createCohort.isPending || cohortLabel.trim().length < 3} onClick={() => createCohort.mutate({ token, campusId: campusId || data.campuses[0]?.id || 0, label: cohortLabel.trim(), cohortStartDate: cohortStart, monthOneEndDate: cohortEnd })}>Add campus month</button>
        </div>
      </Panel>
      <Panel title="Add a full quarter" action={<CalendarCheck2 size={18} />}>
        <div className="resolution-form">
          <label>Launch phase<select value={phase} onChange={(event) => setPhase(Number(event.target.value))}><option value={1}>Phase 1 · five campuses</option><option value={2}>Phase 2 · fifteen campuses</option><option value={3}>Phase 3 · national / 35 campuses</option></select></label>
          <label>Name<input value={quarterLabel} onChange={(event) => setQuarterLabel(event.target.value)} /></label>
          <div className="form-row"><label>Quarter start<input type="date" value={quarterStart} onChange={(event) => setQuarterStart(event.target.value)} /></label><label>Quarter end<input type="date" value={quarterEnd} onChange={(event) => setQuarterEnd(event.target.value)} /></label></div>
          <button className="button secondary" disabled={createQuarter.isPending || quarterLabel.trim().length < 3} onClick={() => createQuarter.mutate({ token, phase, label: quarterLabel.trim(), quarterStartDate: quarterStart, quarterEndDate: quarterEnd })}>Add quarter</button>
        </div>
      </Panel>
    </div>

    <Panel title="Campus first months" action={<span className="result-count">School approval, applicants, reps, sales, ratings and real payouts</span>}>
      {data.cohorts.length ? <div className="table-wrap"><table><thead><tr><th>Campus / month</th><th>Month one</th><th>Approved</th><th>Result</th><th></th></tr></thead><tbody>{data.cohorts.map((cohort) => <tr key={cohort.id}><td><strong>{cohort.campus?.name}</strong><small className="table-sub">{cohort.label}</small></td><td>{cohort.cohortStartDate} → {cohort.monthOneEndDate}</td><td>{cohort.evaluation.passedCount} / {cohort.evaluation.requiredCount}</td><td><StateBadge state={cohort.evaluation.passed ? "evidence_complete_not_campus_live" : "external_evidence_required"} /></td><td><div className="case-actions"><button className="button ghost small" onClick={() => { chooseSubject("campus_cohort", cohort.id); }}>Open</button><button className="button secondary small" disabled={snapshot.isPending} onClick={() => snapshot.mutate({ token, subjectType: "campus_cohort", subjectId: cohort.id })}><Database size={13} />Snapshot</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="Nothing added yet" detail="Add a month to start collecting proof." />}
    </Panel>

    <Panel title="Quarterly targets" action={<span className="result-count">Earlier targets still count</span>}>
      {data.quarters.length ? <div className="table-wrap"><table><thead><tr><th>Phase / quarter</th><th>Full period</th><th>Approved</th><th>Result</th><th></th></tr></thead><tbody>{data.quarters.map((quarter) => <tr key={quarter.id}><td><strong>Phase {quarter.phase}</strong><small className="table-sub">{quarter.label}</small></td><td>{quarter.quarterStartDate} → {quarter.quarterEndDate}</td><td>{quarter.evaluation.passedCount} / {quarter.evaluation.requiredCount}</td><td><StateBadge state={quarter.evaluation.passed ? "evidence_complete_not_launch_certified" : "full_quarter_evidence_required"} /></td><td><div className="case-actions"><button className="button ghost small" onClick={() => { chooseSubject("phase_quarter", quarter.id); }}>Open</button><button className="button secondary small" disabled={snapshot.isPending} onClick={() => snapshot.mutate({ token, subjectType: "phase_quarter", subjectId: quarter.id })}><Database size={13} />Snapshot</button></div></td></tr>)}</tbody></table></div> : <EmptyState title="Nothing added yet" detail="Add a quarter to check its targets." />}
    </Panel>

    {selected && <Panel title={`Gate detail · ${selected.label}`} action={<span className="result-count">{selected.evaluation.passedCount} / {selected.evaluation.requiredCount} passing</span>}>
      <div className="table-wrap"><table><thead><tr><th>What's measured</th><th>Target</th><th>Latest real figure</th><th>From this app</th><th>Decision</th></tr></thead><tbody>{selected.evaluation.checks.map((check) => <tr key={check.key}><td><strong>{check.label}</strong><small className="table-sub mono">{check.key}</small></td><td>{check.requirement}</td><td>{formatValue(check.value, check.unit)}</td><td>{check.systemSnapshots ? `${check.systemSnapshots} · ineligible` : "None"}</td><td><StateBadge state={check.status} /></td></tr>)}</tbody></table></div>
    </Panel>}

    {selected && <Panel title="Add real-world proof" action={<span className="result-count">Needs a second person</span>}>
      <div className="resolution-form">
        <div className="form-row"><label>For<select value={subjectType} onChange={(event) => { chooseSubject(event.target.value as SubjectType, 0); }}><option value="campus_cohort">A campus's first month</option><option value="phase_quarter">A full quarter</option></select></label><label>Which one<select value={selected.id} onChange={(event) => chooseSubject(subjectType, Number(event.target.value))}>{subjects.map((row) => <option key={row.id} value={row.id}>{row.label} · #{row.id}</option>)}</select></label></div>
        <div className="form-row"><label>What's measured<select value={selectedMetric} onChange={(event) => setMetricKey(event.target.value)}>{selected.evaluation.checks.map((check) => <option key={check.key} value={check.key}>{check.label}</option>)}</select></label><label>Real figure<input type="number" step="any" value={metricValue} onChange={(event) => setMetricValue(event.target.value)} placeholder="Use the unit shown above" /></label></div>
        <div className="form-row"><label>From<input type="date" value={selectedPeriodStart} onChange={(event) => setPeriodStartDate(event.target.value)} /></label><label>To<input type="date" value={selectedPeriodEnd} onChange={(event) => setPeriodEndDate(event.target.value)} /></label></div>
        <label>Where the proof is<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Signed report or bank statement reference" /></label>
        <label>What it covers, and any limits<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Who it covers, how it was collected, who owns it, and any limits" /></label>
        <label className="checkbox-label"><input type="checkbox" checked={realWorldAttested} onChange={(event) => setRealWorldAttested(event.target.checked)} />This is real-world proof, not test data.</label>
        <p className="panel-note">A new external submission supersedes earlier submissions for that metric and remains pending until another authorized user reviews it. Do not paste credentials, raw NIN/BVN, bank-account numbers or evidence files.</p>
        <button className="button primary" disabled={submit.isPending || !selectedMetric || metricValue === "" || !realWorldAttested || evidenceReference.trim().length < 3 || note.trim().length < 10} onClick={() => submit.mutate({ token, subjectType, subjectId: selected.id, metricKey: selectedMetric, metricValue: Number(metricValue), periodStartDate: selectedPeriodStart, periodEndDate: selectedPeriodEnd, evidenceReference: evidenceReference.trim(), note: note.trim(), realWorldAttested: true })}><FileCheck2 size={15} />Send for review</button>
      </div>
    </Panel>}

    <Panel title="Proof to review" action={<span className="result-count">Latest {Math.min(data.evidence.length, 60)} records</span>}>
      {data.evidence.length ? <div className="table-wrap"><table><thead><tr><th>Evidence</th><th>Source</th><th>Value / period</th><th>State</th><th>Owner</th><th></th></tr></thead><tbody>{data.evidence.slice(0, 60).map((row) => <tr key={row.id}><td><strong>#{row.id} · {row.metricKey}</strong><small className="table-sub">{row.subjectType} #{row.subjectId} · {row.evidenceReference}</small></td><td><StateBadge state={row.sourceType} />{row.sourceType === "system_snapshot" && <small className="table-sub">Doesn't count</small>}</td><td><strong>{Number(row.metricValue).toLocaleString("en-NG")} {row.unit}</strong><small className="table-sub">{row.periodStartDate} → {row.periodEndDate}</small></td><td><StateBadge state={row.state} /></td><td>Submit #{row.submittedByUserId}{row.reviewedByUserId && <small className="table-sub">Review #{row.reviewedByUserId}</small>}</td><td>{row.state === "submitted" && row.sourceType === "external_evidence" && <button className="button secondary small" onClick={() => { setEvidenceId(row.id); setNotice(""); }}>Review</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="Nothing added yet" detail="Figures from this app and real-world proof will appear here." />}
    </Panel>

    {selectedEvidence && <Panel title={`Independent review · evidence #${selectedEvidence.id}`} action={<button className="button ghost small" onClick={() => setEvidenceId(0)}>Close</button>}>
      <div className="case-facts"><div><span>What's measured</span><strong>{selectedEvidence.metricKey}</strong></div><div><span>Submitter</span><strong>User #{selectedEvidence.submittedByUserId}</strong></div><div><span>Reviewer</span><strong>{user.name} · #{user.id}</strong></div><div><span>Period</span><strong>{selectedEvidence.periodStartDate} → {selectedEvidence.periodEndDate}</strong></div></div>
      <p className="case-description">{selectedEvidence.note}</p>
      <div className="resolution-form"><label>Review reference<input value={reviewReference} onChange={(event) => setReviewReference(event.target.value)} /></label><label>Reason<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={realWorldReviewAttested} onChange={(event) => setRealWorldReviewAttested(event.target.checked)} />I checked the proof myself, for the whole period.</label><div className="case-actions"><button className="button secondary" disabled={review.isPending || !realWorldReviewAttested || reviewReference.trim().length < 3 || note.trim().length < 10} onClick={() => review.mutate({ token, evidenceId: selectedEvidence.id, decision: "rejected", reviewReference: reviewReference.trim(), note: note.trim(), realWorldReviewAttested: true })}><X size={15} />Reject</button><button className="button primary" disabled={review.isPending || !realWorldReviewAttested || reviewReference.trim().length < 3 || note.trim().length < 10} onClick={() => review.mutate({ token, evidenceId: selectedEvidence.id, decision: "approved", reviewReference: reviewReference.trim(), note: note.trim(), realWorldReviewAttested: true })}><Check size={15} />Approve</button></div></div>
    </Panel>}

    <Panel title="History" action={<span className="result-count">Latest {Math.min(data.events.length, 40)} events</span>}>
      {data.events.length ? <div className="audit-list">{data.events.slice(0, 40).map((event) => <div key={event.id}><ClipboardCheck size={16} /><span className="mono">Evidence #{event.evidenceId}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actorName}</span><span>{event.toState}</span></div>)}</div> : <EmptyState title="No history yet" detail="Everything that happens here is recorded." />}
    </Panel>
  </>;
}
