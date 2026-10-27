import { useState } from "react";
import { ArrowRight, Check, CheckCircle2, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Brand } from "@/components/product/Brand";
import { ErrorState, Loading } from "@/components/product/Loading";
import { StateBadge, shortDate } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export default function RecruitAccept() {
  const [params] = useSearchParams();
  const invitationToken = params.get("token") || "";
  const { token, user, setSession } = useWorkspace();
  const invitation = trpc.recruitment.inspect.useQuery({ invitationToken }, { enabled: Boolean(invitationToken), retry: false });
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sandboxCode, setSandboxCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const requestOtp = trpc.auth.requestOtp.useMutation({ onSuccess: (data) => { setSandboxCode(data.sandboxCode); setCode(data.sandboxCode); } });
  const verifyOtp = trpc.auth.verifyOtp.useMutation({ onSuccess: (data) => setSession({ token: data.token, user: data.user }) });
  const accept = trpc.recruitment.accept.useMutation({ onSuccess: () => { setAccepted(true); invitation.refetch(); } });
  const error = requestOtp.error || verifyOtp.error || accept.error;

  return <div className="recruit-page">
    <header className="entry-nav"><Brand /><Link to="/">KampusForce home <ArrowRight size={16} /></Link></header>
    <main className="recruit-main">
      <section className="recruit-intro"><p className="eyebrow">Campus Lead invitation</p><h1>Join the team.<br /><em>Keep the terms clear.</em></h1><p>Verify the invited phone, accept the independent-contractor boundary, and wait for Operations to activate your rep profile.</p><div className="recruit-boundary"><ShieldCheck size={21} /><span><strong>No employment relationship.</strong> No joining fee. No raw NIN or BVN is collected by KampusForce.</span></div></section>
      <section className="recruit-card">
        {!invitationToken ? <ErrorState message="The invitation link is missing its token." /> : invitation.isLoading ? <Loading /> : invitation.error ? <ErrorState message={invitation.error.message} retry={invitation.refetch} /> : invitation.data && <>
          <div className="recruit-card-head"><span className="role-icon"><UserPlus size={22} /></span><div><p className="eyebrow">Invitation for {invitation.data.recruitName}</p><h2>{invitation.data.campus.name}</h2><p>{invitation.data.campus.state} · invited by {invitation.data.leadName}</p></div><StateBadge state={accepted ? "accepted" : invitation.data.status} /></div>
          <div className="recruit-expiry"><span>Invitation expires</span><strong>{shortDate(invitation.data.expiresAt)}</strong></div>
          {accepted ? <div className="recruit-success"><CheckCircle2 size={28} /><h2>Acceptance recorded.</h2><p>Your profile remains pending until Operations completes sandbox identity activation and team assignment. You will receive an in-app notification.</p><Link className="button primary" to="/rep">Open pending rep workspace <ArrowRight size={16} /></Link></div> : invitation.data.status !== "invited" ? <div className="recruit-success"><h2>This invitation is not open.</h2><p>Ask the Campus Lead for a new invitation if you still need access.</p></div> : !token ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (sandboxCode) verifyOtp.mutate({ phone, code, name: name || invitation.data.recruitName }); else requestOtp.mutate({ phone }); }}>
            <p className="eyebrow">01 / VERIFY THE INVITED PHONE</p><label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Use the exact invited number" required /></label>
            {sandboxCode && <><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder={invitation.data.recruitName} /></label><label>Sandbox OTP<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" maxLength={6} required /></label><p className="sandbox-note"><KeyRound size={15} />Sandbox SMS adapter returned the code on screen.</p></>}
            <button className="button primary" disabled={requestOtp.isPending || verifyOtp.isPending}>{sandboxCode ? "Verify phone" : "Send sandbox OTP"}<ArrowRight size={16} /></button>
          </form> : <form className="form-stack" onSubmit={(event) => { event.preventDefault(); accept.mutate({ token, invitationToken, contractorAgreementAccepted: true }); }}>
            <p className="eyebrow">02 / ACCEPT AS {user.name}</p><p className="recruit-signed-phone">Signed in with <strong>{user.phoneE164}</strong></p>
            <label className="contract-check"><input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} required /><span>I accept the sandbox independent-contractor terms and understand that activation, attribution, and commissions are not guaranteed.</span></label>
            <button className="button primary" disabled={!agreement || accept.isPending}><Check size={16} />Accept invitation</button><button className="text-link" type="button" onClick={() => setSession(null)}>Use a different phone</button>
          </form>}
          {error && <p className="form-error" role="alert">{error.message}</p>}
        </>}
      </section>
    </main>
    <footer className="entry-footer"><span>Secure one-time invitation · seven-day expiry</span><span>Phone acceptance → Ops activation</span></footer>
  </div>;
}
