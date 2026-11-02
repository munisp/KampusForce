import { useSystemStatus } from "@/components/product/WorkspaceLayout";
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
  const system = useSystemStatus();
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
      setNotice(`${result.caseRef} sent for review. Operations will check it.`);
      setReference("");
      utils.assurance.overview.invalidate();
    },
  });
  if (overview.isLoading) return <Panel title="Student status"><Loading /></Panel>;
  if (overview.error) return <Panel title="Student status"><ErrorState message={overview.error.message} retry={overview.refetch} /></Panel>;
  const data = overview.data!;
  if (data.scope !== "rep") return null;
  const current = data.preflight.enrollment;
  return <>
    <div className="trust-strip"><GraduationCap size={18} /><span><strong>You also need to show you're a current student.</strong> Operations checks this, and you renew it each term. Don't upload your student records or ID number.</span></div>
    <div className="metrics-grid"><Metric label="Student status" value={current ? "Current" : "Required"} note={current ? `${current.providerName} · ${current.academicTerm}` : "You can't be activated or paid until this is done"} tone={current ? "teal" : "mustard"} /><Metric label="Renew by" value={current?.validUntil ? shortDate(current.validUntil) : "—"} note="Lasts up to 240 days" /><Metric label="Duplicate check" value={data.duplicateReviewOpen ? "Open" : "Clear"} note={data.duplicateReviewOpen ? "Operations must clear the signal; matched-person details stay private" : "No open provider-token collision"} tone={data.duplicateReviewOpen ? "danger" : "teal"} /></div>
    <div className="fraud-intake-grid">
      <Panel title="Show you're a current student" action={<GraduationCap size={18} />}>
        <form className="privacy-form" onSubmit={(event) => { event.preventDefault(); submit.mutate({ token, providerName, providerMode: "sandbox", attestationReference: reference, academicTerm: term, verificationMethod: method, requestedValidUntil: new Date(`${validUntil}T23:59:59.000Z`) }); }}>
          <label>School or records office<input value={providerName} onChange={(event) => setProviderName(event.target.value)} minLength={2} maxLength={80} required /></label>
          <label>Reference from your school or records office<input type="password" value={reference} onChange={(event) => setReference(event.target.value)} minLength={8} maxLength={256} autoComplete="off" placeholder="A reference code, not your student ID" required /><small>We scramble this before saving it, and it's never shown again.</small></label>
          <label>Academic term<input value={term} onChange={(event) => setTerm(event.target.value)} minLength={2} maxLength={40} required /></label>
          <label>How it's confirmed<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="institution_provider">Confirmed by my school</option><option value="institution_document">School document reviewed</option><option value="student_record_provider">Student records service</option></select></label>
          <label>Valid until<input type="date" value={validUntil} min={futureDate(1)} max={futureDate(239)} onChange={(event) => setValidUntil(event.target.value)} required /></label>
          <button className="button primary" disabled={reference.trim().length < 8 || submit.isPending}><ShieldCheck size={15} />Send for review</button>
        </form>
      </Panel>
      <Panel title="Good to know"><div className="fraud-boundaries">{system.testMode && <p><strong>Test mode</strong><span>Your reference isn't checked with your school yet, so this doesn't prove you're enrolled.</span></p>}<p><strong>Matching another account</strong><span>If your details match another account, a person reviews it. We won't show you who matched, and your earnings aren't taken away automatically.</span></p><p><strong>After a sale</strong><span>Refunds and unusual activity can trigger a review or delay your payout.</span></p></div></Panel>
    </div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {submit.error && <p className="form-error" role="alert">{submit.error.message}</p>}
    <Panel title="Your student status history" action={<span className="result-count">{data.enrollments.length} records</span>}>
      {data.enrollments.length ? <div className="table-wrap"><table><thead><tr><th>Case</th><th>School / term</th><th>Submitted</th><th>Valid until</th><th>State</th></tr></thead><tbody>{data.enrollments.map(({ attestation, campusName }) => <tr key={attestation.id}><td><strong>{attestation.caseRef}</strong><small className="table-sub">{campusName}</small></td><td>{attestation.providerName}<small className="table-sub">{attestation.academicTerm}</small></td><td>{shortDate(attestation.submittedAt)}</td><td>{attestation.validUntil ? shortDate(attestation.validUntil) : "Pending review"}</td><td><StateBadge state={attestation.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="Not submitted yet" detail="Send your reference above. Don't enter a NIN, BVN, student number or school document." />}
    </Panel>
    {data.risks.length > 0 && <Panel title="Reviews of your sales" action={<Clock3 size={18} />}><div className="audit-list">{data.risks.map((item) => <div key={item.id}><AlertTriangle size={16} /><span className="mono">{shortDate(item.createdAt)}</span><strong>{item.kind.replaceAll("_", " ")}</strong><span>{item.severity} · deal #{item.dealId}</span><StateBadge state={item.state} /></div>)}</div><p className="panel-note">A review isn't an accusation. Your money only changes through the normal refund process.</p></Panel>}
  </>;
}
