import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, FlaskConical, GraduationCap, Store } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Brand } from "@/components/product/Brand";
import { ErrorState, Loading } from "@/components/product/Loading";
import { startSignIn } from "@/lib/oidc";
import { trpc } from "@/providers/trpc";

type Kind = "student" | "vendor";

export default function Signup() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || undefined;
  const [kind, setKind] = useState<Kind | null>(params.get("as") === "vendor" ? "vendor" : params.get("as") === "student" ? "student" : null);
  const options = trpc.registration.options.useQuery();
  const oidc = trpc.auth.methods.useQuery().data?.oidc;
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [testCode, setTestCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [campusId, setCampusId] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [cacNumber, setCacNumber] = useState("");
  const [terms, setTerms] = useState(false);
  const send = trpc.registration.sendCode.useMutation({ onSuccess: (data) => { setCodeSent(true); setTestCode(data.testCode || ""); } });
  const complete = trpc.registration.complete.useMutation();
  const error = send.error || complete.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    const person = { phone, code, firstName, lastName, email, password, termsAccepted: true as const };
    if (kind === "vendor") complete.mutate({ kind, ...person, companyName, cacNumber });
    else complete.mutate({ kind: "student", ...person, campusId });
  }

  return <div className="recruit-page">
    <header className="entry-nav"><Brand /><Link to="/">Already registered? Sign in <ArrowRight size={16} /></Link></header>
    <main className="recruit-main">
      <section className="recruit-intro">
        <p className="eyebrow">Create your account</p>
        <h1>{kind === "vendor" ? <>Reach campuses.<br /><em>Pay on verified results.</em></> : kind === "student" ? <>Earn on your campus.<br /><em>Keep 80%.</em></> : <>Join KampusForce.<br /><em>Every naira on record.</em></>}</h1>
        <p>{kind === "vendor" ? "Register your business. Operations reviews it before you can list products or fund escrow." : kind === "student" ? "Register as a student rep. Operations activates you once your identity and enrollment are approved." : "Student reps introduce products on campus. Vendors pay commission only on verified activations."}</p>
      </section>
      <section className="recruit-card">
        {options.isLoading ? <Loading /> : options.error ? <ErrorState message={options.error.message} retry={options.refetch} /> : !options.data?.open ? <ErrorState message="Registration is not open yet." /> : complete.isSuccess ? <div className="recruit-success">
          <CheckCircle2 size={28} /><h2>Account created.</h2>
          <p>{kind === "vendor" ? "Sign in, then finish your business check. Operations approves it before you can list products." : "Sign in, then finish identity and enrollment. Operations activates you once they are approved."}</p>
          <button className="button primary" onClick={() => oidc && startSignIn(oidc, returnTo)}>Sign in with Keycloak<ArrowRight size={16} /></button>
        </div> : !kind ? <div className="form-stack">
          <p className="eyebrow">I am a</p>
          <button className="role-card" onClick={() => setKind("student")}><span className="role-icon"><GraduationCap size={22} /></span><span><strong>Student</strong><small>Introduce products on campus and earn commission.</small></span><ArrowRight size={18} /></button>
          <button className="role-card" onClick={() => setKind("vendor")}><span className="role-icon"><Store size={22} /></span><span><strong>Vendor</strong><small>List products and pay for verified activations.</small></span><ArrowRight size={18} /></button>
        </div> : !codeSent ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); send.mutate({ phone }); }}>
          <p className="eyebrow">01 / Verify your phone</p>
          <label>Phone number<input id="signup-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0803 000 0000" required /></label>
          <button className="button primary" disabled={send.isPending}>Send code<ArrowRight size={16} /></button>
          <button className="text-link" type="button" onClick={() => setKind(null)}>Back</button>
        </form> : <form className="form-stack" onSubmit={submit}>
          <p className="eyebrow">02 / Your details</p>
          {testCode && <p className="recruit-signed-phone"><FlaskConical size={15} /> Test mode: no SMS is sent. Your code is <strong id="signup-test-code">{testCode}</strong></p>}
          <label>Code sent to {phone}<input id="signup-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={6} required /></label>
          {kind === "vendor" && <><label>Business name<input id="signup-company" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label>
            <label>CAC registration number<input id="signup-cac" value={cacNumber} onChange={(event) => setCacNumber(event.target.value)} placeholder="RC1234567" required /></label></>}
          {kind === "student" && <label>Campus<select id="signup-campus" value={campusId} onChange={(event) => setCampusId(Number(event.target.value))} required><option value="">Choose your campus</option>{options.data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}, {campus.state}</option>)}</select></label>}
          <label>First name<input id="signup-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
          <label>Last name<input id="signup-last" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
          <label>Email<input id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password, at least 10 characters<input id="signup-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label className="contract-check"><input id="signup-terms" type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>{kind === "vendor" ? "I am authorized to register this business, and I accept that commissions are paid from escrow on verified activations." : "I accept the independent-contractor terms: I am not an employee, and commission is earned only on verified activations."}</span></label>
          <button className="button primary" disabled={complete.isPending || !terms}>Create account<ArrowRight size={16} /></button>
          <button className="text-link" type="button" onClick={() => { setCodeSent(false); setCode(""); setTestCode(""); }}>Use a different phone</button>
        </form>}
        {error && <p className="form-error" role="alert">{error.message}</p>}
      </section>
    </main>
  </div>;
}
