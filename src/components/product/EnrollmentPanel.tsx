import { useState } from "react";
import { AlertTriangle, Check, Clock3, GraduationCap, ShieldCheck } from "lucide-react";
import { EmptyState, Metric, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

function futureDate(days: number) {
  const value = new Date(Date.now() + days * 86_400_000);
  return value.toISOString().slice(0, 10);
}

export function EnrollmentPanel() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const overview = trpc.assurance.overview.useQuery({ token });
  const [providerName, setProviderName] = useState("institution-synthetic");
  const [reference, setReference] = useState("");
  const [term, setTerm] = useState("sandbox-current-term");
  const [method, setMethod] = useState<"institution_provider" | "institution_document" | "student_record_provider">("institution_provider");
  const [validUntil, setValidUntil] = useState(futureDate(120));
  const [notice, setNotice] = useState("");
  const submit = trpc.assurance.submitEnrollment.useMutation({
    onSuccess: (result) => {
      setNotice(`${result.caseRef} submitted for independent enrollment review. No institution outcome is implied yet.`);
      setReference("");
      utils.assurance.overview.invalidate();
    },
  });
  if (overview.isLoading) return <Panel title="Current enrollment"><Loading /></Panel>;
  if (overview.error) return <Panel title="Current enrollment"><ErrorState message={overview.error.message} retry={overview.refetch} /></Panel>;
  const data = overview.data!;
  if (data.scope !== "rep") return null;
  const current = data.preflight.enrollment;
  return <>
    <div className="trust-strip"><GraduationCap size={18} /><span><strong>Identity approval is not proof of current enrollment.</strong> A bounded institution/provider attestation requires independent review and expires by term. Raw student records and academic identifiers stay with the provider.</span></div>
    <div className="metrics-grid"><Metric label="Enrollment" value={current ? "Current" : "Required"} note={current ? `${current.providerName} · ${current.academicTerm}` : "Activation and payout preflight will remain blocked"} tone={current ? "teal" : "mustard"} /><Metric label="Revalidate by" value={current?.validUntil ? shortDate(current.validUntil) : "—"} note="Maximum attestation validity is 240 days" /><Metric label="Duplicate review" value={data.duplicateReviewOpen ? "Open" : "Clear"} note={data.duplicateReviewOpen ? "Operations must clear the signal; matched-person details stay private" : "No open provider-token collision"} tone={data.duplicateReviewOpen ? "danger" : "teal"} /></div>
    <div className="fraud-intake-grid">
      <Panel title="Submit enrollment evidence" action={<GraduationCap size={18} />}>
        <form className="privacy-form" onSubmit={(event) => { event.preventDefault(); submit.mutate({ token, providerName, providerMode: "sandbox", attestationReference: reference, academicTerm: term, verificationMethod: method, requestedValidUntil: new Date(`${validUntil}T23:59:59.000Z`) }); }}>
          <label>Institution or record provider<input value={providerName} onChange={(event) => setProviderName(event.target.value)} minLength={2} maxLength={80} required /></label>
          <label>Provider attestation reference<input type="password" value={reference} onChange={(event) => setReference(event.target.value)} minLength={8} maxLength={256} autoComplete="off" placeholder="One-time opaque provider token—not a student ID" required /><small>The reference is HMAC-tokenized before storage and is never displayed or exported.</small></label>
          <label>Academic term<input value={term} onChange={(event) => setTerm(event.target.value)} minLength={2} maxLength={40} required /></label>
          <label>Evidence method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="institution_provider">Institution provider attestation</option><option value="institution_document">Institution document review</option><option value="student_record_provider">Student-record provider</option></select></label>
          <label>Requested valid until<input type="date" value={validUntil} min={futureDate(1)} max={futureDate(239)} onChange={(event) => setValidUntil(event.target.value)} required /></label>
          <button className="button primary" disabled={reference.trim().length < 8 || submit.isPending}><ShieldCheck size={15} />Submit for independent review</button>
        </form>
      </Panel>
      <Panel title="Vetting boundaries"><div className="fraud-boundaries"><p><strong>Attestation ≠ live institution response</strong><span>Sandbox records exercise the review control only. They do not establish real enrollment.</span></p><p><strong>Collision ≠ fraud conclusion</strong><span>A provider-subject collision opens human review. It never reveals the matched person or automatically reverses earnings.</span></p><p><strong>Activation quality continues after confirmation</strong><span>Refund, repeat-customer, dormancy, chargeback and cluster signals can require step-up review or delay payout.</span></p></div></Panel>
    </div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {submit.error && <p className="form-error" role="alert">{submit.error.message}</p>}
    <Panel title="Enrollment & revalidation history" action={<span className="result-count">{data.enrollments.length} records</span>}>
      {data.enrollments.length ? <div className="table-wrap"><table><thead><tr><th>Case</th><th>Provider / term</th><th>Submitted</th><th>Valid until</th><th>State</th></tr></thead><tbody>{data.enrollments.map(({ attestation, campusName }) => <tr key={attestation.id}><td><strong>{attestation.caseRef}</strong><small className="table-sub">{campusName}</small></td><td>{attestation.providerName}<small className="table-sub">{attestation.academicTerm}</small></td><td>{shortDate(attestation.submittedAt)}</td><td>{attestation.validUntil ? shortDate(attestation.validUntil) : "Pending review"}</td><td><StateBadge state={attestation.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No enrollment attestation" detail="Submit an opaque provider reference above. Do not enter a NIN, BVN, student number or raw academic document." />}
    </Panel>
    {data.risks.length > 0 && <Panel title="Activation-quality review history" action={<Clock3 size={18} />}><div className="audit-list">{data.risks.map((item) => <div key={item.id}><AlertTriangle size={16} /><span className="mono">{shortDate(item.createdAt)}</span><strong>{item.kind.replaceAll("_", " ")}</strong><span>{item.severity} · deal #{item.dealId}</span><StateBadge state={item.state} /></div>)}</div><p className="panel-note">These are review signals, not automatic fraud findings. Financial reversals continue through the existing controlled refund and clawback workflows.</p></Panel>}
  </>;
}
