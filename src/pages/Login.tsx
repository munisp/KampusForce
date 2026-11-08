import { useState } from "react";
import { SIGNED_OUT_REASON_KEY } from "@/providers/workspace";
import { ArrowRight, KeyRound, Landmark, ShieldCheck, Store, UserRound, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { CinematicLanding } from "@/components/landing/CinematicLanding";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { startSignIn } from "@/lib/oidc";

const roles = [
  { role: "rep" as const, repCode: "KF-UNILAG-0001", title: "Campus lead", detail: "Ada · manage a team, overrides and escalations.", icon: UsersRound, path: "/rep" },
  { role: "rep" as const, repCode: "KF-UNILAG-0002", title: "Team rep", detail: "Tobi · share offers, open tickets and track earnings.", icon: UserRound, path: "/rep" },
  { role: "vendor" as const, title: "Vendor partner", detail: "Dry-run rules, fund escrow and resolve support.", icon: Store, path: "/vendor" },
  { role: "ops" as const, title: "Operations", detail: "Monitor SLAs, promote leads and run settlement.", icon: ShieldCheck, path: "/ops" },
  { role: "finance" as const, title: "Finance", detail: "Complete onboarding and review financial-core readiness.", icon: Landmark, path: "/ops" },
];

import { workspacePath } from "@/lib/roles";

export default function Login() {
  const navigate = useNavigate();
  const { setSession, token, user } = useWorkspace();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sandboxCode, setSandboxCode] = useState("");
  const [error, setError] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(() => {
    try { const reason = sessionStorage.getItem(SIGNED_OUT_REASON_KEY); sessionStorage.removeItem(SIGNED_OUT_REASON_KEY); return reason === "expired"; } catch { return false; }
  });
  const methods = trpc.auth.methods.useQuery();
  const oidc = methods.data?.oidc;
  const sandbox = methods.data?.sandbox ?? false;
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
    onSuccess: (data) => { setSession({ token: data.token, user: data.user }); navigate(workspacePath(data.user.role)); },
    onError: (e) => setError(e.message),
  });

  const signIn = oidc ? () => { setError(""); startSignIn(oidc).catch(() => setError("Sign-in could not start. Try again.")); } : undefined;
  const signedIn = token && user;
  const toWorkspace = () => navigate(workspacePath(user?.role ?? "rep"));

  return <>{expiredNotice && <div className="session-ended" role="status"><p><strong>You've been signed out.</strong> Your session ended, so sign in again to carry on.</p><button type="button" aria-label="Dismiss" onClick={() => setExpiredNotice(false)}>×</button></div>}<CinematicLanding
    navAction={signedIn ? <button type="button" className="kf-nav-action" onClick={toWorkspace}>Continue as {user.name} <ArrowRight size={16} /></button>
      : signIn ? <button type="button" className="kf-nav-action" onClick={signIn}>Sign in <ArrowRight size={16} /></button>
      : <a className="kf-nav-action" href="#sandbox">{sandbox ? "Open sandbox" : "Sign in"} <ArrowRight size={16} /></a>}
    primaryAction={signedIn ? <button type="button" className="kf-cta" onClick={toWorkspace}>Continue as {user.name} <ArrowRight size={16} /></button>
      : <a className="kf-cta" href={oidc ? "/signup" : "#sandbox"}>{oidc ? "Create an account" : "Get started"} <ArrowRight size={16} /></a>}
    secondaryAction={!signedIn && signIn ? <button type="button" className="kf-cta kf-cta-quiet" onClick={signIn}>Sign in</button> : undefined}
  >
    <section className="sandbox-section">
        {token && user && <button className="continue-session" onClick={() => navigate(workspacePath(user.role))}>Continue as {user.name}<ArrowRight size={17} /></button>}
        {oidc && <div className="otp-block"><div><KeyRound size={22} /><span><strong>Sign in</strong><small>With your KampusForce account.</small></span></div>
          <button className="button primary" onClick={() => { setError(""); startSignIn(oidc).catch(() => setError("Sign-in could not start. Try again.")); }}>Sign in<ArrowRight size={16} /></button></div>}
        {oidc && <div className="otp-block"><div><UsersRound size={22} /><span><strong>New here?</strong><small>Create an account as a campus rep or a vendor.</small></span></div>
          <a className="button secondary" href="/signup">Create an account<ArrowRight size={16} /></a></div>}
        {!sandbox && error && <p className="form-error" role="alert">{error}</p>}
        {sandbox && <>
        <div className="section-intro"><p className="eyebrow">Executable product slice</p><h2>Choose a workspace.</h2><p>Use seeded sandbox identities to exercise the same database-backed activation, escrow and settlement records. No real money or KYC checks occur.</p></div>
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
        </>}
    </section>
  </CinematicLanding></>;
}
