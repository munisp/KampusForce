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
  const submit = trpc.ops.submitLaunchEvidence.useMutation(submitted("Proof sent. Someone else in Operations needs to approve it."));
  const approve = trpc.ops.approveLaunchEvidence.useMutation(submitted("Approval recorded. This only notes that it was given; it doesn't check the outside system."));
  const reject = trpc.ops.rejectLaunchEvidence.useMutation(submitted("Evidence rejected. Your decision is on record."));
  const error = submit.error || approve.error || reject.error;
  const gates = useMemo(() => readiness.data?.gates.filter((gate) => track === "all" || gate.track === track) || [], [readiness.data, track]);
  const selected = readiness.data?.gates.find((gate) => gate.id === gateId);

  if (readiness.isLoading) return <Loading />;
  if (readiness.error) return <ErrorState message={readiness.error.message} retry={readiness.refetch} />;
  const data = readiness.data!;
  return <>
    <div className="trust-strip"><ClipboardCheck size={18} /><span><strong>This checklist doesn't switch anything on.</strong> Approving an item only records that someone checked the proof. It doesn't make the platform live or legally compliant.</span></div>
    <div className="metrics-grid">
      <Metric label="Items to finish" value={data.summary.required} note="Legal, Finance, Ops, Engineering and Product" />
      <Metric label="Approved" value={`${data.summary.approved} / ${data.summary.required}`} note="Checked by a second person" tone="teal" />
      <Metric label="Awaiting review" value={data.summary.awaitingReview} note="You can't approve your own" tone={data.summary.awaitingReview ? "mustard" : "default"} />
      <Metric label="Going live" value={data.summary.canRequestExternalCutover ? "Evidence complete" : "Blocked"} note="Decided outside this app" tone={data.summary.canRequestExternalCutover ? "teal" : "mustard"} />
    </div>
    <div className="sandbox-banner"><ShieldX size={18} /><p><strong>Not ready for real money yet.</strong> {data.summary.boundary}</p></div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {error && <p className="form-error" role="alert">{error.message}</p>}
    <Panel title="Connected services" action={<span className="result-count">Mode: {data.configuration.effectiveMode === "live" ? "live" : "test"}</span>}>
      <div className="table-wrap"><table><thead><tr><th>Service</th><th>Used for</th><th>Key added</th><th>Callbacks checked</th><th>Safety setting</th></tr></thead><tbody>{data.configuration.providers.map((provider) => <tr key={provider.key}><td><strong>{provider.name}</strong><small className="table-sub mono">{provider.adapter}</small></td><td>{provider.role}</td><td>{provider.credentialConfigured ? "Configured" : "Not configured"}</td><td>{provider.webhookVerificationConfigured ? "Configured" : "Not configured"}</td><td><StateBadge state={provider.liveExecutionEnabled ? "configuration_present" : "fail_closed"} /></td></tr>)}</tbody></table></div>
      <p className="panel-note">HTTPS application URL: {data.configuration.appUrlHttps ? "configured" : "not configured"} · explicit cutover flag: {data.configuration.cutoverAuthorized ? "present" : "absent"}. Boolean configuration metadata only; credential values are never returned.</p>
      <ul className="compact-list">{data.configuration.boundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
    </Panel>
    <Panel title="Checklist" action={<label className="inline-filter">Team<select value={track} onChange={(event) => { setTrack(event.target.value as Track); setGateId(0); }}><option value="all">All teams</option><option value="legal">Legal</option><option value="finance">Finance</option><option value="ops">Ops</option><option value="engineering">Engineering</option><option value="product">Product</option></select></label>}>
      {gates.length ? <div className="table-wrap"><table><thead><tr><th>Item</th><th>Team</th><th>Proof</th><th>State</th><th></th></tr></thead><tbody>{gates.map((gate) => <tr key={gate.id}><td><strong>{gate.title}</strong><small className="table-sub">{gate.requirement}</small></td><td>{gate.track}{!gate.required && <small className="table-sub">Optional</small>}</td><td>{gate.evidenceReference || gate.evidenceHint}{gate.submittedByUserId && <small className="table-sub">Submitted by user #{gate.submittedByUserId} · {gate.submittedAt ? shortDate(gate.submittedAt) : "—"}</small>}</td><td><StateBadge state={gate.state} /></td><td>{gate.state !== "approved" && <button className="button secondary small" onClick={() => { setGateId(gate.id); setNotice(""); }}>{gate.state === "evidence_submitted" ? "Review" : "Submit evidence"}</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="Nothing for this team" detail="Choose another team." />}
    </Panel>
    {selected && <Panel title={`${selected.state === "evidence_submitted" ? "Independent review" : "Submit evidence"} · ${selected.title}`} action={<button className="button ghost small" onClick={() => setGateId(0)}>Close</button>}>
      <p className="case-description">{selected.requirement} <strong>Proof needed:</strong> {selected.evidenceHint}</p>
      {selected.state === "evidence_submitted" && <div className="case-facts"><div><span>Where the proof is</span><strong>{selected.evidenceReference}</strong></div><div><span>Sent by</span><strong>User #{selected.submittedByUserId}</strong></div><div><span>Reviewer</span><strong>{user.name} · #{user.id}</strong></div></div>}
      <div className="resolution-form">
        {selected.state === "evidence_submitted" ? <label>Approval reference<input value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} placeholder="Approval reference" /></label> : <label>Where the proof is<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Document or ticket reference" /></label>}
        <label>Note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it covers, who owns it, and any limits" /></label>
        <p className="panel-note">Only add references and notes, not passwords, NIN, BVN, account numbers or files.</p>
        {selected.state === "evidence_submitted" ? <div className="case-actions"><button className="button secondary" disabled={reject.isPending || approve.isPending || decisionReference.trim().length < 3 || note.trim().length < 10} onClick={() => reject.mutate({ token, gateId: selected.id, rejectionReference: decisionReference.trim(), note: note.trim() })}><X size={15} />Reject</button><button className="button primary" disabled={approve.isPending || reject.isPending || decisionReference.trim().length < 3 || note.trim().length < 10} onClick={() => approve.mutate({ token, gateId: selected.id, approvalReference: decisionReference.trim(), note: note.trim() })}><FileCheck2 size={15} />Approve</button></div> : <button className="button primary" disabled={submit.isPending || evidenceReference.trim().length < 3 || note.trim().length < 10} onClick={() => submit.mutate({ token, gateId: selected.id, evidenceReference: evidenceReference.trim(), note: note.trim() })}><ExternalLink size={15} />Send for review</button>}
      </div>
    </Panel>}
    <Panel title="History" action={<span className="result-count">Latest {Math.min(data.events.length, 30)} events</span>}>
      {data.events.length ? <div className="audit-list">{data.events.slice(0, 30).map((event) => <div key={event.id}><ClipboardCheck size={16} /><span className="mono">{shortDate(event.createdAt)}</span><strong>{event.action.replaceAll("_", " ")}</strong><span>{data.gates.find((gate) => gate.id === event.gateId)?.title || `Gate ${event.gateId}`}</span><span>{event.actorName}</span></div>)}</div> : <EmptyState title="Nothing sent yet" detail="Submissions and decisions will appear here." />}
    </Panel>
  </>;
}
