import { useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, Gavel, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { EmptyState, Metric, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export function FraudDesk() {
  const { token } = useWorkspace();
  const overview = trpc.ops.overview.useQuery({ token });
  const utils = trpc.useUtils();
  const [caseId, setCaseId] = useState(0);
  const [repId, setRepId] = useState(0);
  const [intakeNote, setIntakeNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [conductAction, setConductAction] = useState<"strike" | "suspension">("strike");
  const [notice, setNotice] = useState("");
  const refresh = () => { utils.ops.overview.invalidate(); utils.rep.fraudCases.invalidate(); utils.rep.me.invalidate(); };
  const create = trpc.ops.createFraudCase.useMutation({
    onSuccess: (result) => {
      setNotice(`${result.caseRef} opened with an active payout hold. Review is due ${shortDate(result.reviewDueAt)}.`);
      setCaseId(result.caseId);
      setIntakeNote("");
      refresh();
    },
  });
  const review = trpc.ops.reviewFraudCase.useMutation({
    onSuccess: (result) => {
      setNotice(result.state === "released"
        ? `${result.caseRef} released. Its payout hold is off; the case history remains append-only.`
        : `${result.caseRef} upheld with a ${result.conductAction}. No automatic financial reversal was applied.`);
      setReviewNote("");
      refresh();
    },
  });
  const selected = useMemo(() => overview.data?.fraudCases.find((row) => row.fraudCase.id === caseId) || overview.data?.fraudCases[0], [overview.data, caseId]);
  const selectedHold = overview.data?.fraudHolds.find((hold) => hold.caseId === selected?.fraudCase.id);
  const selectedEvents = overview.data?.fraudCaseEvents.filter((event) => event.caseId === selected?.fraudCase.id).sort((a, b) => a.id - b.id) || [];
  if (overview.isLoading) return <Loading />;
  if (overview.error) return <ErrorState message={overview.error.message} retry={overview.refetch} />;
  const data = overview.data!;
  const evidence = selected?.fraudCase.evidenceJson || {};
  return <>
    <div className="trust-strip"><ShieldAlert size={18} /><span><strong>Rule-based fraud controls, not ML or AML certification.</strong> Caps and manual review create payout holds and evidence. They do not score identities, report regulators, or automatically reverse money.</span></div>
    <div className="metrics-grid"><Metric label="Open reviews" value={data.metrics.openFraudCases} note="New cases plus appeals" tone="mustard" /><Metric label="Overdue" value={data.metrics.overdueFraudCases} note="Beyond the 24-hour objective" tone={data.metrics.overdueFraudCases ? "danger" : "default"} /><Metric label="Blocking holds" value={data.metrics.blockingFraudHolds} note="Active and upheld" tone={data.metrics.blockingFraudHolds ? "danger" : "default"} /><Metric label="Default daily cap" value="10 / rep" note="Current rules may set a product cap" tone="teal" /></div>
    <div className="fraud-intake-grid">
      <Panel title="Open a manual review" action={<ShieldCheck size={18} />}>
        <form className="privacy-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, repId, note: intakeNote.trim() }); }}>
          <label>Representative<select value={repId} onChange={(event) => setRepId(Number(event.target.value))} required><option value={0}>Select a representative</option>{data.fraudRepOptions.map(({ rep, user, campus }) => <option key={rep.id} value={rep.id}>{user.name} · {rep.code} · {campus.name}</option>)}</select></label>
          <label>Evidence and reason for hold<textarea value={intakeNote} onChange={(event) => setIntakeNote(event.target.value)} minLength={10} maxLength={2000} placeholder="Record the operational evidence reviewed; do not paste NIN, BVN, bank details or customer phone numbers" /><small>The hold blocks new payout assembly and dispatch immediately. It does not change ledger entries.</small></label>
          <button className="button primary" disabled={!repId || intakeNote.trim().length < 10 || create.isPending}><ShieldAlert size={15} />Open case & hold payouts</button>
        </form>
      </Panel>
      <Panel title="Control boundaries"><div className="fraud-boundaries"><p><strong>Atomic daily window</strong><span>Unique non-duplicate activation submissions are counted in Africa/Lagos days. The eleventh default submission is quarantined and opens a hold.</span></p><p><strong>Release is scoped</strong><span>Releasing one case turns off only its hold. Any other active or upheld case continues to block payouts.</span></p><p><strong>Financial action stays controlled</strong><span>An upheld decision records whether clawback review is required. Existing refund and Finance workflows must perform any reversal.</span></p></div></Panel>
    </div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {(create.error || review.error) && <p className="form-error" role="alert">{(create.error || review.error)?.message}</p>}
    <div className="case-workspace fraud-workspace">
      <Panel title="Fraud & conduct queue" className="case-inbox" action={<span className="result-count">24-hour review objective</span>}>
        {data.fraudCases.length ? <div className="ticket-list">{data.fraudCases.map((row) => {
          const hold = data.fraudHolds.find((item) => item.caseId === row.fraudCase.id);
          return <button key={row.fraudCase.id} className={selected?.fraudCase.id === row.fraudCase.id ? "selected" : ""} onClick={() => setCaseId(row.fraudCase.id)}><span className="ticket-ref">{row.fraudCase.caseRef}</span><strong>{row.user.name}</strong><small>{row.campus.name} · {row.fraudCase.reason.replaceAll("_", " ")}</small><span className="ticket-meta"><StateBadge state={row.fraudCase.state} />{hold && <StateBadge state={hold.state} />}{row.overdue && <em><AlertTriangle size={12} />Overdue</em>}</span></button>;
        })}</div> : <EmptyState title="No fraud cases" detail="Cap breaches and Operations manual reviews will appear here with their hold state and evidence timeline." />}
      </Panel>
      <Panel title={selected ? `${selected.fraudCase.caseRef} · ${selected.user.name}` : "Case review"} className="case-detail" action={selected ? <StateBadge state={selected.fraudCase.state} /> : null}>
        {selected ? <>
          <div className="case-facts"><div><span>Representative</span><strong>{selected.rep.code}</strong></div><div><span>Campus</span><strong>{selected.campus.name}</strong></div><div><span>Review due</span><strong>{shortDate(selected.fraudCase.reviewDueAt)}</strong></div><div><span>Payout hold</span><strong>{selectedHold?.state || "missing"}</strong></div></div>
          <div className="fraud-evidence"><p><span>Reason</span><strong>{selected.fraudCase.reason.replaceAll("_", " ")}</strong></p>{typeof evidence.attemptCount === "number" && <p><span>Observed / cap</span><strong>{evidence.attemptCount} / {String(evidence.cap)}</strong></p>}{typeof evidence.windowStart === "string" && <p><span>Velocity window</span><strong>{shortDate(evidence.windowStart)} – {shortDate(String(evidence.windowEnd))}</strong></p>}<p><span>Conduct action</span><strong>{selected.fraudCase.conductAction}</strong></p></div>
          {selected.fraudCase.appealNote && <div className="appeal-note"><Gavel size={17} /><p><strong>Representative appeal</strong><span>{selected.fraudCase.appealNote}</span></p></div>}
          {selected.fraudCase.reviewNote && <p className="panel-note"><strong>Latest decision:</strong> {selected.fraudCase.reviewNote}</p>}
          {["open", "appeal_open"].includes(selected.fraudCase.state) && <div className="resolution-form"><label>Decision evidence<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} minLength={10} maxLength={2000} placeholder="Evidence reviewed, decision rationale and any controlled clawback follow-up" /></label><label>Conduct action if upheld<select value={conductAction} onChange={(event) => setConductAction(event.target.value as "strike" | "suspension")}><option value="strike">Strike; upheld hold remains</option><option value="suspension">Suspend representative; upheld hold remains</option></select></label><div className="decision-actions"><button className="button secondary" disabled={reviewNote.trim().length < 10 || review.isPending} onClick={() => review.mutate({ token, caseId: selected.fraudCase.id, decision: "release", conductAction, note: reviewNote.trim() })}><X size={15} />Release hold</button><button className="button primary" disabled={reviewNote.trim().length < 10 || review.isPending} onClick={() => review.mutate({ token, caseId: selected.fraudCase.id, decision: "uphold", conductAction, note: reviewNote.trim() })}><ShieldAlert size={15} />Uphold case</button></div><p className="privacy-note"><AlertTriangle size={15} />Upholding does not void deals, post clawbacks or send regulatory reports. Release after an appeal restores the prior rep status only when no other upheld suspension remains.</p></div>}
        </> : <EmptyState title="Select a case" detail="Review the cap evidence, hold state and append-only decision history." />}
      </Panel>
    </div>
    {selected && <Panel title="Append-only case history" action={<span className="result-count">{selectedEvents.length} events</span>}><div className="audit-list">{selectedEvents.map((event) => <div key={event.id}><Clock3 size={16} /><span className="mono">{shortDate(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.fromState || "detected"} → {event.toState || "open"}</span><span>Actor {event.actorUserId || "fraud control"}</span></div>)}</div><p className="panel-note">History records case and hold decisions. It does not contain customer phone values, vendor payloads, NIN/BVN or bank details.</p></Panel>}
  </>;
}
