import { useState, type FormEvent } from "react";
import { ArrowRight, GraduationCap, Mail, Store } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Brand } from "@/components/product/Brand";
import { ErrorState, Loading } from "@/components/product/Loading";
import { trpc } from "@/providers/trpc";

type Kind = "student" | "vendor";

export default function Signup() {
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || undefined;
  const [kind, setKind] = useState<Kind | null>(params.get("as") === "vendor" ? "vendor" : params.get("as") === "student" ? "student" : null);
  const options = trpc.registration.options.useQuery();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [campusId, setCampusId] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [cacNumber, setCacNumber] = useState("");
  const [terms, setTerms] = useState(false);
  const complete = trpc.registration.complete.useMutation();
  const interest = trpc.registration.registerInterest.useMutation();
  const [notListed, setNotListed] = useState(false);
  const [university, setUniversity] = useState("");
  const [universityState, setUniversityState] = useState("");
  const error = complete.error || interest.error;

  function submit(event: FormEvent) {
    event.preventDefault();
    const person = { firstName, lastName, email, termsAccepted: true as const, returnTo };
    if (kind === "vendor") complete.mutate({ kind, ...person, companyName, cacNumber });
    else complete.mutate({ kind: "student", ...person, campusId });
  }

  return <div className="recruit-page">
    <header className="entry-nav"><Brand /><Link to="/">Already registered? Sign in <ArrowRight size={16} /></Link></header>
    <main className="recruit-main">
      <section className="recruit-intro">
        <p className="eyebrow">Create your account</p>
        <h1>{kind === "vendor" ? <>Reach students.<br /><em>Pay only for real sales.</em></> : kind === "student" ? <>Earn on your campus.<br /><em>Keep 80%.</em></> : <>Join KampusForce.<br /><em>Every naira on record.</em></>}</h1>
        <p>{kind === "vendor" ? "Register your business. Operations checks it before you can list products or add funds." : kind === "student" ? "Register as a student rep. Operations activates you once your identity and student status are approved." : "Student reps introduce products on campus. Vendors pay commission only on real sales."}</p>
      </section>
      <section className="recruit-card">
        {options.isLoading ? <Loading /> : options.error ? <ErrorState message={options.error.message} retry={options.refetch} /> : !options.data?.open ? <ErrorState message="Registration is not open yet." /> : complete.isSuccess ? <div className="recruit-success" id="signup-done">
          <Mail size={28} /><h2>Check your email.</h2>
          <p>If <strong>{email}</strong> is new to us, we've sent a link to verify it and choose your password. It lasts 24 hours and may land in spam. Already registered? Just sign in.</p>
          <p>{kind === "vendor" ? "After signing in, finish your business check. Operations approves it before you can list products." : "After signing in, finish identity and enrollment. Operations activates you once they are approved."}</p>
          <Link className="button secondary" to="/">Back to sign in</Link>
        </div> : !kind ? <div className="form-stack">
          <p className="eyebrow">I am a</p>
          <button className="role-card" onClick={() => setKind("student")}><span className="role-icon"><GraduationCap size={22} /></span><span><strong>Student</strong><small>Share products on campus and earn commission.</small></span><ArrowRight size={18} /></button>
          <button className="role-card" onClick={() => setKind("vendor")}><span className="role-icon"><Store size={22} /></span><span><strong>Vendor</strong><small>List your products and pay commission only on real sales.</small></span><ArrowRight size={18} /></button>
        </div> : notListed ? (interest.isSuccess ? <div className="recruit-success" id="interest-done">
          <h2>Thanks, we've noted your university.</h2>
          <p>KampusForce isn't open at {university} yet. Your request helps Operations decide where to launch next.</p>
          <Link className="button secondary" to="/">Back to home</Link>
        </div> : <form className="form-stack" onSubmit={(event) => { event.preventDefault(); interest.mutate({ university, state: universityState, email }); }}>
          <p className="eyebrow">Ask us to open your university</p>
          <label>University<input id="interest-university" value={university} onChange={(event) => setUniversity(event.target.value)} minLength={3} required /></label>
          <label>State<input id="interest-state" value={universityState} onChange={(event) => setUniversityState(event.target.value)} minLength={2} required /></label>
          <label>Email<input id="interest-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <button className="button primary" disabled={interest.isPending}>Send<ArrowRight size={16} /></button>
          <button className="text-link" type="button" onClick={() => setNotListed(false)}>Back</button>
        </form>) : <form className="form-stack" onSubmit={submit}>
          <p className="eyebrow">Your details</p>
          {kind === "vendor" && <><label>Business name<input id="signup-company" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label>
            <label>CAC number<input id="signup-cac" value={cacNumber} onChange={(event) => setCacNumber(event.target.value)} placeholder="RC1234567" required /></label></>}
          {kind === "student" && <label>Campus<select id="signup-campus" value={campusId} onChange={(event) => setCampusId(Number(event.target.value))} required><option value="">Choose your campus</option>{options.data.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}, {campus.state}</option>)}</select></label>}
          {kind === "student" && <button className="text-link" id="signup-not-listed" type="button" onClick={() => setNotListed(true)}>My university isn't listed</button>}
          <label>First name<input id="signup-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
          <label>Last name<input id="signup-last" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
          <label>Email<input id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="contract-check"><input id="signup-terms" type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>{kind === "vendor" ? "I am authorized to register this business, and I accept that commission is paid from my wallet when a sale is confirmed." : "I accept the independent-contractor terms: I am not an employee, and I earn commission only on sales the vendor confirms."}</span></label>
          <button className="button primary" disabled={complete.isPending || !terms}>Create account<ArrowRight size={16} /></button>
          <button className="text-link" type="button" onClick={() => setKind(null)}>Back</button>
        </form>}
        {error && <p className="form-error" role="alert">{error.message}</p>}
      </section>
    </main>
  </div>;
}
