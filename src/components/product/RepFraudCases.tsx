import { useState } from "react";
import { AlertTriangle, Clock3, Gavel, ShieldAlert } from "lucide-react";
import { Panel } from "./WorkspaceLayout";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export function RepFraudCases() {
  const { token } = useWorkspace();
  const fraud = trpc.rep.fraudCases.useQuery({ token });
  const utils = trpc.useUtils();
  const [appealNotes, setAppealNotes] = useState<Record<number, string>>({});
  const appeal = trpc.rep.appealFraudCase.useMutation({
    onSuccess: () => {
      setAppealNotes({});
      utils.rep.fraudCases.invalidate();
      utils.rep.me.invalidate();
      utils.ops.overview.invalidate();
    },
  });
  if (!fraud.data?.cases.length) return null;
  const cases = fraud.data.cases;
  return <Panel title="Fraud review & payout holds" action={<span className="result-count">Operations decisions are audited</span>}>
    <div className="trust-strip"><ShieldAlert size={18} /><span><strong>Your commission records are not automatically reversed by a fraud case.</strong> Active and upheld holds block payouts while Operations reviews the evidence. An upheld case can be appealed once.</span></div>
    <div className="rep-fraud-list">{cases.map((fraudCase) => {
      const hold = fraud.data.holds.find((item) => item.caseId === fraudCase.id);
      const events = fraud.data.events.filter((event) => event.caseId === fraudCase.id).sort((a, b) => a.id - b.id);
      return <article key={fraudCase.id}>
        <div className="rep-fraud-heading"><div><span className="ticket-ref">{fraudCase.caseRef}</span><h3>{fraudCase.reason.replaceAll("_", " ")}</h3><small>Review due {shortDate(fraudCase.reviewDueAt)}</small></div><div><StateBadge state={fraudCase.state} />{hold && <StateBadge state={`${hold.state} hold`} />}</div></div>
        {fraudCase.reviewNote && <p><strong>Operations decision:</strong> {fraudCase.reviewNote}</p>}
        {fraudCase.state === "upheld" && <div className="resolution-form"><label>Appeal evidence<textarea value={appealNotes[fraudCase.id] || ""} onChange={(event) => setAppealNotes((current) => ({ ...current, [fraudCase.id]: event.target.value }))} minLength={10} maxLength={2000} placeholder="Explain the decision being appealed and the evidence Operations should review" /></label><button className="button secondary" disabled={(appealNotes[fraudCase.id] || "").trim().length < 10 || appeal.isPending} onClick={() => appeal.mutate({ token, caseId: fraudCase.id, note: (appealNotes[fraudCase.id] || "").trim() })}><Gavel size={15} />Request appeal</button></div>}
        {fraudCase.state === "appeal_open" && <p className="appeal-note"><AlertTriangle size={16} /><span>Your appeal is awaiting Operations review. The upheld hold remains active during that review.</span></p>}
        <div className="audit-list">{events.map((event) => <div key={event.id}><Clock3 size={15} /><span className="mono">{shortDate(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.fromState || "detected"} → {event.toState || "open"}</span></div>)}</div>
      </article>;
    })}</div>
    {appeal.error && <p className="form-error" role="alert">{appeal.error.message}</p>}
  </Panel>;
}
