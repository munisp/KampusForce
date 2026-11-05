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
      setNotice(`${result.caseRef} opened and payouts are paused. Review it by ${shortDate(result.reviewDueAt)}.`);
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
    <div className="trust-strip"><ShieldAlert size={18} /><span><strong>Fraud checks follow simple rules.</strong> A rep who goes over a limit, or who you flag, has their payouts paused. Nothing is reported or taken back automatically.</span></div>
    <div className="metrics-grid"><Metric label="Open reviews" value={data.metrics.openFraudCases} note="New reviews and appeals" tone="mustard" /><Metric label="Overdue" value={data.metrics.overdueFraudCases} note="Older than 24 hours" tone={data.metrics.overdueFraudCases ? "danger" : "default"} /><Metric label="Paused payouts" value={data.metrics.blockingFraudHolds} note="Reps paused now" tone={data.metrics.blockingFraudHolds ? "danger" : "default"} /><Metric label="Daily sales limit" value="10 / rep" note="Some products have their own" tone="teal" /></div>
    <div className="fraud-intake-grid">
      <Panel title="Flag a rep" action={<ShieldCheck size={18} />}>
        <form className="privacy-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, repId, note: intakeNote.trim() }); }}>
          <label>Rep<select value={repId} onChange={(event) => setRepId(Number(event.target.value))} required><option value={0}>Choose a rep</option>{data.fraudRepOptions.map(({ rep, user, campus }) => <option key={rep.id} value={rep.id}>{user.name} · {rep.code} · {campus.name}</option>)}</select></label>
          <label>Why are you pausing their payouts?<textarea value={intakeNote} onChange={(event) => setIntakeNote(event.target.value)} minLength={10} maxLength={2000} placeholder="What did you see? Don't include NIN, BVN, bank details or customer phone numbers" /><small>Their payouts pause right away. Their earnings aren't changed.</small></label>
          <button className="button primary" disabled={!repId || intakeNote.trim().length < 10 || create.isPending}><ShieldAlert size={15} />Open review and pause payouts</button>
        </form>
      </Panel>
      <Panel title="Good to know"><div className="fraud-boundaries"><p><strong>Daily limit</strong><span>By default a rep can have 10 sales a day. The 11th is held and opens a review.</span></p><p><strong>Releasing a pause</strong><span>This ends one pause only. Any other open review keeps payouts paused.</span></p><p><strong>Taking money back</strong><span>Confirming fraud doesn't take money back. Finance does that separately through the refund process.</span></p></div></Panel>
    </div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {(create.error || review.error) && <p className="form-error" role="alert">{(create.error || review.error)?.message}</p>}
    <div className="case-workspace fraud-workspace">
      <Panel title="Fraud reviews" className="case-inbox" action={<span className="result-count">Aim to review within 24 hours</span>}>
        {data.fraudCases.length ? <div className="ticket-list">{data.fraudCases.map((row) => {
          const hold = data.fraudHolds.find((item) => item.caseId === row.fraudCase.id);
          return <button key={row.fraudCase.id} className={selected?.fraudCase.id === row.fraudCase.id ? "selected" : ""} onClick={() => setCaseId(row.fraudCase.id)}><span className="ticket-ref">{row.fraudCase.caseRef}</span><strong>{row.user.name}</strong><small>{row.campus.name} · {row.fraudCase.reason.replaceAll("_", " ")}</small><span className="ticket-meta"><StateBadge state={row.fraudCase.state} />{hold && <StateBadge state={hold.state} />}{row.overdue && <em><AlertTriangle size={12} />Overdue</em>}</span></button>;
        })}</div> : <EmptyState title="No reviews" detail="Reps who go over a limit or get flagged will appear here." />}
      </Panel>
      <Panel title={selected ? `${selected.fraudCase.caseRef} · ${selected.user.name}` : "Case review"} className="case-detail" action={selected ? <StateBadge state={selected.fraudCase.state} /> : null}>
        {selected ? <>
          <div className="case-facts"><div><span>Rep</span><strong>{selected.rep.code}</strong></div><div><span>Campus</span><strong>{selected.campus.name}</strong></div><div><span>Review due</span><strong>{shortDate(selected.fraudCase.reviewDueAt)}</strong></div><div><span>Payout hold</span><strong>{selectedHold?.state || "missing"}</strong></div></div>
          <div className="fraud-evidence"><p><span>Reason</span><strong>{selected.fraudCase.reason.replaceAll("_", " ")}</strong></p>{typeof evidence.attemptCount === "number" && <p><span>Sales / limit</span><strong>{evidence.attemptCount} / {String(evidence.cap)}</strong></p>}{typeof evidence.windowStart === "string" && <p><span>Time period</span><strong>{shortDate(evidence.windowStart)} – {shortDate(String(evidence.windowEnd))}</strong></p>}<p><span>Action taken</span><strong>{selected.fraudCase.conductAction}</strong></p></div>
          {selected.fraudCase.appealNote && <div className="appeal-note"><Gavel size={17} /><p><strong>Rep's appeal</strong><span>{selected.fraudCase.appealNote}</span></p></div>}
          {selected.fraudCase.reviewNote && <p className="panel-note"><strong>Latest decision:</strong> {selected.fraudCase.reviewNote}</p>}
          {["open", "appeal_open"].includes(selected.fraudCase.state) && <div className="resolution-form"><label>Reason<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} minLength={10} maxLength={2000} placeholder="What you checked, your decision, and whether Finance needs to act" /></label><label>Action if confirmed<select value={conductAction} onChange={(event) => setConductAction(event.target.value as "strike" | "suspension")}><option value="strike">Give a warning and keep payouts paused</option><option value="suspension">Suspend the rep and keep payouts paused</option></select></label><div className="decision-actions"><button className="button secondary" disabled={reviewNote.trim().length < 10 || review.isPending} onClick={() => review.mutate({ token, caseId: selected.fraudCase.id, decision: "release", conductAction, note: reviewNote.trim() })}><X size={15} />Resume payouts</button><button className="button primary" disabled={reviewNote.trim().length < 10 || review.isPending} onClick={() => review.mutate({ token, caseId: selected.fraudCase.id, decision: "uphold", conductAction, note: reviewNote.trim() })}><ShieldAlert size={15} />Confirm fraud</button></div><p className="privacy-note"><AlertTriangle size={15} />Confirming doesn't cancel sales, take money back or report anyone. If the rep wins an appeal, they go back to their old status unless another suspension applies.</p></div>}
        </> : <EmptyState title="Choose a review" detail="Its details will appear here." />}
      </Panel>
    </div>
    {selected && <Panel title="What's happened" action={<span className="result-count">{selectedEvents.length} events</span>}><div className="audit-list">{selectedEvents.map((event) => <div key={event.id}><Clock3 size={16} /><span className="mono">{shortDate(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.fromState || "detected"} → {event.toState || "open"}</span><span>Actor {event.actorUserId || "fraud control"}</span></div>)}</div><p className="panel-note">Decisions are recorded here without any customer or bank details.</p></Panel>}
  </>;
}
