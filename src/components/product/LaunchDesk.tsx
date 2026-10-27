import { useMemo, useState } from "react";
import { Check, ClipboardCheck, ExternalLink, FileCheck2, ShieldX, X } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type Track = "all" | "legal" | "finance" | "ops" | "engineering" | "product";

export function LaunchDesk() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const readiness = trpc.ops.launchReadiness.useQuery({ token });
  const [track, setTrack] = useState<Track>("all");
  const [gateId, setGateId] = useState(0);
  const [evidenceReference, setEvidenceReference] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = () => utils.ops.launchReadiness.invalidate();
  const submitted = (message: string) => ({
    onSuccess: () => {
      setNotice(message);
      setEvidenceReference("");
      setDecisionReference("");
      setNote("");
      setGateId(0);
      refresh();
    },
  });
  const submit = trpc.ops.submitLaunchEvidence.useMutation(submitted("Evidence reference submitted for independent review."));
  const approve = trpc.ops.approveLaunchEvidence.useMutation(submitted("External approval attestation recorded. This does not certify the external system."));
  const reject = trpc.ops.rejectLaunchEvidence.useMutation(submitted("Evidence rejected with an append-only review record."));
  const error = submit.error || approve.error || reject.error;
  const gates = useMemo(() => readiness.data?.gates.filter((gate) => track === "all" || gate.track === track) || [], [readiness.data, track]);
  const selected = readiness.data?.gates.find((gate) => gate.id === gateId);

  if (readiness.isLoading) return <Loading />;
  if (readiness.error) return <ErrorState message={readiness.error.message} retry={readiness.refetch} />;
  const data = readiness.data!;
  return <>
    <div className="trust-strip"><ClipboardCheck size={18} /><span><strong>Evidence control, not a go-live button.</strong> Approvals attest that named external evidence was reviewed. They do not activate providers, certify legal/security compliance, or mark this sandbox production-ready.</span></div>
    <div className="metrics-grid">
      <Metric label="Required gates" value={data.summary.required} note="Legal, Finance, Ops, Engineering and Product" />
      <Metric label="Approved attestations" value={`${data.summary.approved} / ${data.summary.required}`} note="Independent four-eyes review" tone="teal" />
      <Metric label="Awaiting review" value={data.summary.awaitingReview} note="Submitter cannot self-approve" tone={data.summary.awaitingReview ? "mustard" : "default"} />
      <Metric label="External cutover" value={data.summary.canRequestExternalCutover ? "Evidence complete" : "Blocked"} note="Real approval remains external" tone={data.summary.canRequestExternalCutover ? "teal" : "mustard"} />
    </div>
    <div className="sandbox-banner"><ShieldX size={18} /><p><strong>productionReady: false.</strong> {data.summary.boundary}</p></div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {error && <p className="form-error" role="alert">{error.message}</p>}
    <Panel title="Secret-free integration configuration" action={<span className="result-count">Effective mode: {data.configuration.effectiveMode}</span>}>
      <div className="table-wrap"><table><thead><tr><th>Adapter</th><th>Role</th><th>Server credential</th><th>Webhook verification</th><th>Execution guard</th></tr></thead><tbody>{data.configuration.providers.map((provider) => <tr key={provider.key}><td><strong>{provider.name}</strong><small className="table-sub mono">{provider.adapter}</small></td><td>{provider.role}</td><td>{provider.credentialConfigured ? "Configured" : "Not configured"}</td><td>{provider.webhookVerificationConfigured ? "Configured" : "Not configured"}</td><td><StateBadge state={provider.liveExecutionEnabled ? "configuration_present" : "fail_closed"} /></td></tr>)}</tbody></table></div>
      <p className="panel-note">HTTPS application URL: {data.configuration.appUrlHttps ? "configured" : "not configured"} · explicit cutover flag: {data.configuration.cutoverAuthorized ? "present" : "absent"}. Boolean configuration metadata only; credential values are never returned.</p>
      <ul className="compact-list">{data.configuration.boundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
    </Panel>
    <Panel title="Launch evidence register" action={<label className="inline-filter">Track<select value={track} onChange={(event) => { setTrack(event.target.value as Track); setGateId(0); }}><option value="all">All tracks</option><option value="legal">Legal</option><option value="finance">Finance</option><option value="ops">Ops</option><option value="engineering">Engineering</option><option value="product">Product</option></select></label>}>
      {gates.length ? <div className="table-wrap"><table><thead><tr><th>Gate</th><th>Track</th><th>Evidence</th><th>State</th><th></th></tr></thead><tbody>{gates.map((gate) => <tr key={gate.id}><td><strong>{gate.title}</strong><small className="table-sub">{gate.requirement}</small></td><td>{gate.track}{!gate.required && <small className="table-sub">Optional · no launch credit</small>}</td><td>{gate.evidenceReference || gate.evidenceHint}{gate.submittedByUserId && <small className="table-sub">Submitted by user #{gate.submittedByUserId} · {gate.submittedAt ? shortDate(gate.submittedAt) : "—"}</small>}</td><td><StateBadge state={gate.state} /></td><td>{gate.state !== "approved" && <button className="button secondary small" onClick={() => { setGateId(gate.id); setNotice(""); }}>{gate.state === "evidence_submitted" ? "Review" : "Submit evidence"}</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No gates in this track" detail="Choose another launch track." />}
    </Panel>
    {selected && <Panel title={`${selected.state === "evidence_submitted" ? "Independent review" : "Submit evidence"} · ${selected.title}`} action={<button className="button ghost small" onClick={() => setGateId(0)}>Close</button>}>
      <p className="case-description">{selected.requirement} <strong>Evidence expected:</strong> {selected.evidenceHint}</p>
      {selected.state === "evidence_submitted" && <div className="case-facts"><div><span>Evidence reference</span><strong>{selected.evidenceReference}</strong></div><div><span>Submitter</span><strong>User #{selected.submittedByUserId}</strong></div><div><span>Reviewer</span><strong>{user.name} · #{user.id}</strong></div></div>}
      <div className="resolution-form">
        {selected.state === "evidence_submitted" ? <label>External approval / rejection reference<input value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} placeholder="Signed review or decision register reference" /></label> : <label>Evidence reference<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Controlled document, ticket or report reference—not its contents" /></label>}
        <label>Review note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evidence scope, owner, limitations and decision rationale" /></label>
        <p className="panel-note">References and notes only. Do not paste credentials, raw NIN/BVN, bank-account numbers or evidence files.</p>
        {selected.state === "evidence_submitted" ? <div className="case-actions"><button className="button secondary" disabled={reject.isPending || approve.isPending || decisionReference.trim().length < 3 || note.trim().length < 10} onClick={() => reject.mutate({ token, gateId: selected.id, rejectionReference: decisionReference.trim(), note: note.trim() })}><X size={15} />Reject evidence</button><button className="button primary" disabled={approve.isPending || reject.isPending || decisionReference.trim().length < 3 || note.trim().length < 10} onClick={() => approve.mutate({ token, gateId: selected.id, approvalReference: decisionReference.trim(), note: note.trim() })}><FileCheck2 size={15} />Attest external approval</button></div> : <button className="button primary" disabled={submit.isPending || evidenceReference.trim().length < 3 || note.trim().length < 10} onClick={() => submit.mutate({ token, gateId: selected.id, evidenceReference: evidenceReference.trim(), note: note.trim() })}><ExternalLink size={15} />Submit for independent review</button>}
      </div>
    </Panel>}
    <Panel title="Append-only launch history" action={<span className="result-count">Latest {Math.min(data.events.length, 30)} events</span>}>
      {data.events.length ? <div className="audit-list">{data.events.slice(0, 30).map((event) => <div key={event.id}><ClipboardCheck size={16} /><span className="mono">{shortDate(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{data.gates.find((gate) => gate.id === event.gateId)?.title || `Gate ${event.gateId}`}</span><span>{event.actorName}</span></div>)}</div> : <EmptyState title="No launch evidence submitted" detail="Submission and independent decisions will appear here without deleting earlier history." />}
    </Panel>
  </>;
}
