import { useState } from "react";
import { AlertTriangle, Check, Clock3, UserCheck, X } from "lucide-react";
import { EmptyState, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { DocumentPreview } from "./IdentityDocuments";
import { shortDate } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

// The two steps after a new campus rep's ID check, on the ID checks page so a new rep is reviewed in one place:
// confirm their proof of enrolment, then activate them.

const MIN_REASON = 10;

export function useNewRepCounts() {
  const { token, user } = useWorkspace();
  const staff = ["ops", "admin", "finance"].includes(user.role);
  const assurance = trpc.assurance.overview.useQuery({ token }, { enabled: staff });
  const reps = trpc.ops.repsToActivate.useQuery({ token }, { enabled: staff });
  const enrolments = assurance.data?.scope === "operations" ? assurance.data.enrollments.filter((row) => row.attestation.state === "submitted").length : 0;
  return { enrolments, toActivate: reps.data?.filter((r) => r.ready).length ?? 0 };
}

export function EnrolmentProofs({ onDecided }: { onDecided: (message: string) => void }) {
  const { token, user } = useWorkspace();
  const canDecide = ["ops", "admin"].includes(user.role);
  const utils = trpc.useUtils();
  const overview = trpc.assurance.overview.useQuery({ token });
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const review = trpc.assurance.reviewEnrollment.useMutation({
    onSuccess: (item) => {
      onDecided(item.state === "verified" ? "Enrolment confirmed. If their ID check is approved too, they're now under Ready to activate." : "Enrolment proof refused. The rep is asked to send it again.");
      utils.assurance.overview.invalidate(); utils.ops.repsToActivate.invalidate();
    },
  });
  if (overview.isLoading) return <Loading />;
  if (overview.error) return <ErrorState message={overview.error.message} retry={overview.refetch} />;
  const data = overview.data!;
  const rows = data.scope === "operations" ? data.enrollments.filter((row) => row.attestation.state === "submitted") : [];
  return <Panel title="Enrolment proofs to check" action={<span className="result-count">{rows.length} waiting</span>}>
    <p className="panel-note">Each new campus rep sends proof they're enrolled this term: a school ID card, fee receipt or course form. Check the name and the term, then confirm it.</p>
    {review.error && <p className="form-error" role="alert">{review.error.message}</p>}
    {rows.length ? <div className="new-rep-list">{rows.map(({ attestation, user: rep, campusName, proofDocumentId, proofUsedByAnotherAccount }) => {
      const reason = (reasons[attestation.id] || "").trim();
      return <article key={attestation.id} className="new-rep-card">
        <header><div><strong>{rep.name}</strong><small>{campusName} · sent {shortDate(attestation.submittedAt)}</small></div><span className="new-rep-badge waiting"><Clock3 size={13} />To check</span></header>
        <dl><div><dt>School</dt><dd>{attestation.providerName}</dd></div><div><dt>Term</dt><dd>{attestation.academicTerm}</dd></div><div><dt>Asked to be valid until</dt><dd>{shortDate(attestation.requestedValidUntil)}</dd></div></dl>
        {proofUsedByAnotherAccount && <p className="identity-overdue"><AlertTriangle size={14} /> The same file was uploaded by another account. Look closely before confirming.</p>}
        {proofDocumentId ? <DocumentPreview documentId={proofDocumentId} label={`${rep.name}'s proof of enrolment`} /> : <p className="panel-note">No file was attached.</p>}
        {canDecide && <div className="new-rep-decision">
          <label htmlFor={`enrol-reason-${attestation.id}`}>Reason for your decision</label>
          <input id={`enrol-reason-${attestation.id}`} value={reasons[attestation.id] || ""} onChange={(e) => setReasons({ ...reasons, [attestation.id]: e.target.value })} maxLength={500} placeholder="e.g. Name and term match the fee receipt" />
          <small>At least {MIN_REASON} characters. The rep sees it if you refuse. Don't type ID or account numbers.</small>
          <div className="decision-actions">
            <button className="button secondary small" disabled={reason.length < MIN_REASON || review.isPending} onClick={() => review.mutate({ token, caseId: attestation.id, decision: "reject", reason })}><X size={13} />Refuse</button>
            <button className="button primary small" disabled={reason.length < MIN_REASON || review.isPending} onClick={() => review.mutate({ token, caseId: attestation.id, decision: "verify", reason })}><Check size={13} />Confirm enrolment</button>
          </div>
        </div>}
      </article>;
    })}</div> : <EmptyState title="No enrolment proofs waiting" detail="New campus reps' proofs appear here as soon as they send them." />}
  </Panel>;
}

export function RepsToActivate({ onDecided }: { onDecided: (message: string) => void }) {
  const { token, user } = useWorkspace();
  const canActivate = ["ops", "admin"].includes(user.role);
  const utils = trpc.useUtils();
  const list = trpc.ops.repsToActivate.useQuery({ token });
  const done = (name: string) => { onDecided(`${name} is active and has been told. They can share products now.`); utils.ops.repsToActivate.invalidate(); };
  const activate = trpc.ops.activateRep.useMutation();
  const activateInvited = trpc.ops.activateRecruitment.useMutation();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={list.error.message} retry={list.refetch} />;
  const rows = list.data || [];
  const ready = rows.filter((r) => r.ready);
  const notYet = rows.filter((r) => !r.ready);
  const go = async (row: (typeof rows)[number]) => {
    setError(""); setBusy(row.repId);
    try {
      if (row.invitationId) await activateInvited.mutateAsync({ token, recruitmentId: row.invitationId });
      else await activate.mutateAsync({ token, repId: row.repId });
      done(row.name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That rep couldn't be activated.");
    } finally { setBusy(null); }
  };
  return <>
    <Panel title="Ready to activate" action={<span className="result-count">{ready.length} ready</span>}>
      <p className="panel-note">Their ID check and enrolment are approved and they've accepted the contractor terms. Activating lets them share products and earn.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {ready.length ? <div className="new-rep-list">{ready.map((row) => <article key={row.repId} className="new-rep-card ready">
        <header><div><strong>{row.name}</strong><small>{row.campusName} · {row.email}{row.invitationId ? " · invited by a campus lead" : ""}</small></div><span className="new-rep-badge ok"><Check size={13} />Checks done</span></header>
        {canActivate && <div className="decision-actions"><button className="button primary small" disabled={busy === row.repId} onClick={() => go(row)}><UserCheck size={14} />{busy === row.repId ? "Activating…" : "Activate rep"}</button></div>}
      </article>)}</div> : <EmptyState title="Nobody is ready yet" detail="Reps appear here once their ID check and enrolment are both approved." />}
    </Panel>
    {notYet.length > 0 && <Panel title="Still finishing their checks" action={<span className="result-count">{notYet.length}</span>}>
      <div className="new-rep-list compact">{notYet.map((row) => <article key={row.repId} className="new-rep-card">
        <header><div><strong>{row.name}</strong><small>{row.campusName} · registered {shortDate(row.createdAt)}</small></div><span className="new-rep-badge waiting"><Clock3 size={13} />Waiting</span></header>
        <ul className="new-rep-missing">{row.waitingOn.map((item) => <li key={item}>{item}</li>)}</ul>
      </article>)}</div>
    </Panel>}
  </>;
}
