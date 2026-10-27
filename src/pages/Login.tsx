import { useState } from "react";
import { ArrowRight, Check, KeyRound, ShieldCheck, Store, UserRound, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { Brand } from "@/components/product/Brand";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

const roles = [
  { role: "rep" as const, title: "Campus lead", detail: "Ada · manage a team, overrides and escalations.", icon: UsersRound, path: "/rep" },
  { role: "rep" as const, repCode: "KF-UNILAG-0002", title: "Team rep", detail: "Tobi · share offers, open tickets and track earnings.", icon: UserRound, path: "/rep" },
  { role: "vendor" as const, title: "Vendor partner", detail: "Dry-run rules, fund escrow and resolve support.", icon: Store, path: "/vendor" },
  { role: "ops" as const, title: "Operations", detail: "Monitor SLAs, promote leads and run settlement.", icon: ShieldCheck, path: "/ops" },
];

export default function Login() {
  const navigate = useNavigate();
  const { setSession, token, user } = useWorkspace();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sandboxCode, setSandboxCode] = useState("");
  const [error, setError] = useState("");
  const demo = trpc.auth.demoLogin.useMutation({
    onSuccess: (data, variables) => {
      setSession({ token: data.token, user: data.user });
      navigate(roles.find((r) => r.role === variables.role)?.path || "/rep");
    },
    onError: (e) => setError(e.message),
  });
  const requestOtp = trpc.auth.requestOtp.useMutation({
    onSuccess: (data) => { setSandboxCode(data.sandboxCode); setCode(data.sandboxCode); setError(""); },
    onError: (e) => setError(e.message),
  });
  const verifyOtp = trpc.auth.verifyOtp.useMutation({
    onSuccess: (data) => { setSession({ token: data.token, user: data.user }); navigate(data.user.role === "rep" ? "/rep" : `/${data.user.role}`); },
    onError: (e) => setError(e.message),
  });

  return <div className="entry-page">
    <header className="entry-nav"><Brand /><a href="#sandbox">Open sandbox <ArrowRight size={16} /></a></header>
    <main>
      <section className="entry-hero">
        <div className="entry-copy">
          <p className="eyebrow"><span className="live-dot" />Campus commerce, accounted for</p>
          <h1>Every activation.<br /><em>Every naira.</em><br />One clear record.</h1>
          <p className="entry-lede">KampusForce connects vendors, verified student reps and customers—then turns vendor-verified activations into transparent commissions and payouts.</p>
          <div className="entry-principles">
            <span><Check size={16} />80% to the rep</span><span><Check size={16} />No joining fees</span><span><Check size={16} />Vendor-funded escrow</span>
          </div>
        </div>
        <div className="entry-ledger" aria-label="Commission example">
          <div className="ledger-top"><span>COMMISSION TRACE</span><span className="mono">KF / 001</span></div>
          <div className="ledger-event"><span className="pulse-ring"><KeyRound size={20} /></span><div><small>VENDOR-VERIFIED EVENT</small><strong>First successful activation</strong></div><span className="verified-chip">VERIFIED</span></div>
          <div className="ledger-amount"><small>Funded commission</small><strong>₦1,000</strong></div>
          <div className="split-bar"><span /><span /></div>
          <div className="split-labels"><div><strong>₦800</strong><span>Student rep · 80%</span></div><div><strong>₦200</strong><span>Platform · 20%</span></div></div>
          <div className="ledger-flow"><span>Pending</span><ArrowRight size={14} /><span>Confirmed</span><ArrowRight size={14} /><span>Payable</span><ArrowRight size={14} /><span>Paid</span></div>
          <p>Money moves only after the event and escrow checks pass.</p>
        </div>
      </section>

      <section className="sandbox-section" id="sandbox">
        <div className="section-intro"><p className="eyebrow">Executable product slice</p><h2>Choose a workspace.</h2><p>Use seeded sandbox identities to exercise the same database-backed activation, escrow and settlement records. No real money or KYC checks occur.</p></div>
        {token && user && <button className="continue-session" onClick={() => navigate(user.role === "rep" ? "/rep" : `/${user.role}`)}>Continue as {user.name}<ArrowRight size={17} /></button>}
        <div className="role-grid">
          {roles.map(({ role, repCode, title, detail, icon: Icon }) => <button className="role-card" key={title} onClick={() => { setError(""); demo.mutate({ role, repCode }); }} disabled={demo.isPending}>
            <span className="role-icon"><Icon size={22} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={18} />
          </button>)}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="otp-block">
          <div><UsersRound size={22} /><span><strong>New rep phone sign-in</strong><small>Sandbox SMS returns the OTP directly on screen.</small></span></div>
          <form onSubmit={(e) => { e.preventDefault(); if (sandboxCode) verifyOtp.mutate({ phone, code, name }); else requestOtp.mutate({ phone }); }}>
            <label>Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0800 000 0000" required /></label>
            {sandboxCode && <><label>Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required /></label><label>Sandbox code<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required /></label></>}
            <button className="button primary" disabled={requestOtp.isPending || verifyOtp.isPending}>{sandboxCode ? "Verify & enter" : "Send sandbox OTP"}<ArrowRight size={16} /></button>
          </form>
        </div>
      </section>
    </main>
    <footer className="entry-footer"><span>Phase 4 settlement · Nigeria</span><span>Rules → teams → support → settlement</span></footer>
  </div>;
}
