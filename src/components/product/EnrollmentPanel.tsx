import { useState } from "react";
import { AlertTriangle, Check, Clock3, GraduationCap, ShieldCheck } from "lucide-react";
import { EmptyState, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { fullDate, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { documentLabels, fileToBase64, MAX_DOCUMENT_BYTES, shrinkPhoto } from "@/lib/files";

function futureDate(days: number) {
  const value = new Date(Date.now() + days * 86_400_000);
  return value.toISOString().slice(0, 10);
}

export function EnrollmentPanel() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const overview = trpc.assurance.overview.useQuery({ token });
  const [providerName, setProviderName] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [proofError, setProofError] = useState("");
  const uploadProof = trpc.assurance.uploadStudentProof.useMutation();
  const [term, setTerm] = useState("");
  const [validUntil, setValidUntil] = useState(futureDate(120));
  const [notice, setNotice] = useState("");
  const submit = trpc.assurance.submitEnrollment.useMutation({
    onSuccess: (result) => {
      setNotice(`${result.caseRef} sent for review. Operations will check it.`);
      utils.assurance.overview.invalidate();
    },
  });
  if (overview.isLoading) return <Panel title="Enrolment status"><Loading /></Panel>;
  if (overview.error) return <Panel title="Enrolment status"><ErrorState message={overview.error.message} retry={overview.refetch} /></Panel>;
  const data = overview.data!;
  if (data.scope !== "rep") return null;
  const current = data.preflight.enrollment;
  const pending = data.enrollments.some(({ attestation }) => attestation.state === "submitted");
  const showForm = !pending && (!current || renewing);
  return <>
    <Panel title="Enrolment status" action={<StateBadge state={current ? "verified" : pending ? "manual_review" : "pending"} />}>
      <div className="identity-detail">
        <p className={`identity-next${current ? "" : pending ? "" : " identity-next-needs_more_info"}`}>{current ? `Your enrolment is confirmed until ${fullDate(current.validUntil)}.` : pending ? "Operations is checking your proof. You'll get a notification when they decide." : "You also need to show you're currently enrolled. You can't be activated or paid until this is done."}</p>
        {data.duplicateReviewOpen && <p className="form-error">Your details match another account, so a person is reviewing it. We won't show you who matched.</p>}
        {current && !renewing && <button className="button secondary small" onClick={() => setRenewing(true)}>Renew now</button>}
      </div>
    </Panel>
    {showForm && <div className="fraud-intake-grid">
      <Panel title="Show you're currently enrolled" action={<GraduationCap size={18} />}>
        <form className="privacy-form" onSubmit={async (event) => { event.preventDefault(); setProofError(""); if (!proof) return; if (proof.size > MAX_DOCUMENT_BYTES) { setProofError("That file is too big. The limit is 10 MB."); return; } try { const { documentId } = await uploadProof.mutateAsync({ token, contentBase64: await fileToBase64(await shrinkPhoto(proof)) }); submit.mutate({ token, providerName, providerMode: "sandbox", documentId, academicTerm: term, verificationMethod: "institution_document", requestedValidUntil: new Date(`${validUntil}T23:59:59.000Z`) }); setProof(null); (event.target as HTMLFormElement).reset(); } catch (failure) { setProofError(failure instanceof Error ? failure.message : "That upload failed. Please try again."); } }}>
          <label>Your school<input value={providerName} onChange={(event) => setProviderName(event.target.value)} minLength={2} maxLength={80} required /></label>
          <label>{documentLabels.student_proof.title}<input id="student-proof" type="file" accept="image/jpeg,image/png,application/pdf" required onChange={(event) => setProof(event.target.files?.[0] || null)} /><small>{documentLabels.student_proof.hint} JPG, PNG or PDF, up to 10 MB.</small></label>
          {proofError && <p className="form-error" role="alert">{proofError}</p>}
          <label>Academic term<input value={term} onChange={(event) => setTerm(event.target.value)} minLength={2} maxLength={40} placeholder="2026/2027, first semester" required /></label>
          <label>Valid until<input type="date" value={validUntil} min={futureDate(1)} max={futureDate(239)} onChange={(event) => setValidUntil(event.target.value)} required /></label>
          <button className="button primary" disabled={!proof || uploadProof.isPending || submit.isPending}><ShieldCheck size={15} />Send for review</button>
        </form>
      </Panel>
      <Panel title="Good to know"><div className="fraud-boundaries"><p><strong>How it's checked</strong><span>Operations looks at your proof. They don't contact your school. Your file is encrypted and deleted 30 days after a decision.</span></p><p><strong>Matching another account</strong><span>If your details match another account, a person reviews it. We won't show you who matched, and your earnings aren't taken away automatically.</span></p><p><strong>After a sale</strong><span>Refunds and unusual activity can trigger a review or delay your payout.</span></p></div></Panel>
    </div>}
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {submit.error && <p className="form-error" role="alert">{submit.error.message}</p>}
    <Panel title="Your enrolment history">
      {data.enrollments.length ? <div className="table-wrap"><table><thead><tr><th>School / term</th><th>Submitted</th><th>Valid until</th><th>State</th></tr></thead><tbody>{data.enrollments.map(({ attestation }) => <tr key={attestation.id}><td>{attestation.providerName}<small className="table-sub">{attestation.academicTerm}</small></td><td>{shortDate(attestation.submittedAt)}</td><td>{attestation.validUntil ? shortDate(attestation.validUntil) : "Pending review"}</td><td><StateBadge state={attestation.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="Not submitted yet" detail="Upload your proof above." />}
    </Panel>
    {data.risks.length > 0 && <Panel title="Reviews of your sales" action={<Clock3 size={18} />}><div className="audit-list">{data.risks.map((item) => <div key={item.id}><AlertTriangle size={16} /><span className="mono">{shortDate(item.createdAt)}</span><strong>{item.kind.replaceAll("_", " ")}</strong><span>{item.severity} · deal #{item.dealId}</span><StateBadge state={item.state} /></div>)}</div><p className="panel-note">A review isn't an accusation. Your money only changes through the normal refund process.</p></Panel>}
  </>;
}
