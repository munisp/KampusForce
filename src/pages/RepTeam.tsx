import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleDollarSign, Copy, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export default function RepTeam() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const team = trpc.rep.team.useQuery({ token });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [repId, setRepId] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const refresh = () => { utils.rep.team.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.earnings.invalidate(); };
  const recruit = trpc.rep.recruitRep.useMutation({ onSuccess: (result) => { setName(""); setPhone(""); setNote(""); setInviteLink(`${window.location.origin}${result.acceptancePath}`); setNotice("One-time invitation created. The recruit must accept with the invited phone before Operations can activate the profile."); refresh(); } });
  const revoke = trpc.rep.revokeRecruitment.useMutation({ onSuccess: () => { setNotice("Invitation revoked. The one-time link can no longer be accepted."); refresh(); } });
  const assign = trpc.rep.assignTeamMember.useMutation({ onSuccess: () => { setRepId(""); setNotice("Existing campus rep assigned to your team."); refresh(); } });
  if (team.isLoading) return <WorkspaceLayout title="Campus team" subtitle="Lead-owned recruiting and platform-margin overrides."><Loading /></WorkspaceLayout>;
  if (team.error) return <WorkspaceLayout title="Campus team" subtitle="Lead-only workspace"><ErrorState message={team.error.message} retry={team.refetch} /></WorkspaceLayout>;
  const data = team.data!;
  if (!data.isLead) return <WorkspaceLayout title="Campus team" subtitle="Top-decile leadership is designated by campus operations."><div className="trust-strip"><ShieldCheck size={18} /><span><strong>Rep workspace</strong> · Campus Leads are contractors, not employees.</span></div><Panel title="Lead access is not assigned"><EmptyState title="You are not a Campus Lead" detail="Campus operations ranks active reps by confirmed commission. Top-decile reps with signed contractor agreements can be designated as leads." /></Panel></WorkspaceLayout>;
  const accrued = data.overrides.filter((row) => row.override.state === "accrued").reduce((sum, row) => sum + row.override.overrideKobo, 0);
  const paid = data.overrides.filter((row) => row.override.state === "paid").reduce((sum, row) => sum + row.override.overrideKobo, 0);
  const marginAfter = data.overrides.reduce((sum, row) => sum + row.override.platformMarginAfterKobo, 0);
  return <WorkspaceLayout title="Build the team. See the margin." subtitle={`${data.lead.code} · Campus Lead contractor · 5% team override funded by KampusForce`}>
    <div className="trust-strip"><UsersRound size={18} /><span><strong>Lead-owned recruiting and support triage</strong> · Overrides never reduce the activating rep’s 80% share or add vendor escrow liability.</span></div>
    <div className="metrics-grid"><Metric label="Active team reps" value={data.members.length} note="Assigned on your campus" /><Metric label="Accrued overrides" value={money(accrued)} note="Awaiting an eligible payout batch" tone="mustard" /><Metric label="Paid overrides" value={money(paid)} note="Gross before batch withholding" tone="teal" /><Metric label="Platform margin retained" value={money(marginAfter)} note="Across recorded team overrides" /></div>
    <div className="team-layout">
      <Panel title="Team performance" action={<span className="result-count">5% of confirmed team rep commission</span>}>
        {data.members.length ? <div className="table-wrap"><table><thead><tr><th>Rep</th><th>Status</th><th>Activations</th><th>Confirmed commission</th><th>Quality</th><th>Assigned</th></tr></thead><tbody>{data.members.map((row) => <tr key={row.member.id}><td><strong>{row.user.name}</strong><small className="table-sub mono">{row.member.code}</small></td><td><StateBadge state={row.member.status} /></td><td>{row.activations}</td><td><strong>{money(row.confirmedKobo)}</strong><small className="table-sub">Override base</small></td><td>{row.member.qualityScore}/100</td><td>{shortDate(row.assignment.assignedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No team members assigned" detail="Assign an active rep on your campus or record a recruiting invitation below." />}
      </Panel>
      <Panel title="Recruit & assign" className="recruit-panel">
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); recruit.mutate({ token, name, phone, note: note || undefined }); }}><p className="eyebrow">01 / LEAD-OWNED RECRUITING</p><label>Recruit name<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} required /></label><label>Recruit phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0800 000 0000" required /></label><label>Note <span className="optional">optional</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} /></label><button className="button primary" disabled={recruit.isPending}><UserPlus size={16} />Record invitation</button>{recruit.error && <p className="form-error">{recruit.error.message}</p>}</form>
        <form className="assign-form" onSubmit={(event) => { event.preventDefault(); assign.mutate({ token, repId: Number(repId) }); }}><label>Assign existing active rep <span className="optional">sandbox numeric rep ID</span><div className="inline-form"><input type="number" min="1" value={repId} onChange={(event) => setRepId(event.target.value)} required /><button className="button secondary" disabled={assign.isPending || !repId}>Assign <ArrowRight size={14} /></button></div></label>{assign.error && <p className="form-error">{assign.error.message}</p>}</form>
        {notice && <p className="success-message"><CheckCircle2 size={16} />{notice}</p>}
        {inviteLink && <div className="invite-link"><label>One-time acceptance link<input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></label><button className="button secondary small" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={14} />Copy link</button><small>The raw token is shown only after creation; the database stores its SHA-256 hash.</small></div>}
        {revoke.error && <p className="form-error">{revoke.error.message}</p>}
      </Panel>
    </div>
    <Panel title="Platform-margin override ledger" action={<span className="result-count"><CircleDollarSign size={14} /> Independent of vendor escrow</span>}>
      {data.overrides.length ? <div className="table-wrap"><table><thead><tr><th>Deal / source rep</th><th>Team commission</th><th>5% override</th><th>Original platform margin</th><th>Margin after override</th><th>State</th></tr></thead><tbody>{data.overrides.map(({ override, sourceRepCode }) => <tr key={override.id}><td><strong>#{override.dealId}</strong><small className="table-sub mono">{sourceRepCode}</small></td><td>{money(override.teamCommissionKobo)}</td><td><strong>{money(override.overrideKobo)}</strong></td><td>{money(override.platformMarginKobo)}</td><td>{money(override.platformMarginAfterKobo)}</td><td><StateBadge state={override.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No team overrides yet" detail="When an assigned team rep’s deal confirms, 5% of that rep’s gross commission accrues to you from platform revenue. Refunds reverse it." />}
    </Panel>
    <div className="team-lower"><Panel title="Recruiting invitations">{data.recruitments.length ? <div className="recruitment-list">{data.recruitments.map((recruit) => <div key={recruit.id}><UserPlus size={17} /><p><strong>{recruit.name}</strong><small>{recruit.phoneE164} · {shortDate(recruit.invitedAt)}</small>{recruit.note && <em>{recruit.note}</em>}</p><StateBadge state={recruit.status} />{["invited", "accepted"].includes(recruit.status) && <button className="icon-button" title="Revoke invitation" aria-label={`Revoke invitation for ${recruit.name}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ token, recruitmentId: recruit.id })}><X size={15} /></button>}</div>)}</div> : <EmptyState title="No invitations" detail="Recruiting invitations remain unactivated until operations completes verification." />}</Panel><Panel title="Contractor boundary"><div className="contract-note"><ShieldCheck size={23} /><h3>Leadership is not employment.</h3><p>Campus operations designates eligible leads and owns activation controls. A recruiting invitation does not verify identity, create an employment relationship, or guarantee payouts.</p><p>Top-decile rank is calculated from confirmed team performance; current seed fixtures are for workflow verification, not evidence of real-world performance.</p></div></Panel></div>
  </WorkspaceLayout>;
}
