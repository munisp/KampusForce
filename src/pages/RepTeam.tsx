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
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [repId, setRepId] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const refresh = () => { utils.rep.team.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.earnings.invalidate(); };
  const recruit = trpc.rep.recruitRep.useMutation({ onSuccess: (result) => { setName(""); setEmail(""); setNote(""); setInviteLink(`${window.location.origin}${result.acceptancePath}`); setNotice("Invitation created. Once the student accepts it, Operations can activate them."); refresh(); } });
  const revoke = trpc.rep.revokeRecruitment.useMutation({ onSuccess: () => { setNotice("Invitation cancelled. The link no longer works."); refresh(); } });
  const assign = trpc.rep.assignTeamMember.useMutation({ onSuccess: () => { setRepId(""); setNotice("Rep added to your team."); refresh(); } });
  if (team.isLoading) return <WorkspaceLayout title="Campus team" subtitle="Recruit reps and earn a bonus on your team's sales."><Loading /></WorkspaceLayout>;
  if (team.error) return <WorkspaceLayout title="Campus team" subtitle="Campus leads only"><ErrorState message={team.error.message} retry={team.refetch} /></WorkspaceLayout>;
  const data = team.data!;
  if (!data.isLead) return <WorkspaceLayout title="Campus team" subtitle="Operations chooses campus leads from the top reps."><div className="trust-strip"><ShieldCheck size={18} /><span><strong>Student rep</strong> · Campus leads are contractors, not employees.</span></div><Panel title="You're not a campus lead yet"><EmptyState title="You're not a campus lead yet" detail="Operations ranks reps on each campus by confirmed commission. The top 10% with a signed contract can become leads." /></Panel></WorkspaceLayout>;
  const accrued = data.overrides.filter((row) => row.override.state === "accrued").reduce((sum, row) => sum + row.override.overrideKobo, 0);
  const paid = data.overrides.filter((row) => row.override.state === "paid").reduce((sum, row) => sum + row.override.overrideKobo, 0);
  const marginAfter = data.overrides.reduce((sum, row) => sum + row.override.platformMarginAfterKobo, 0);
  return <WorkspaceLayout title="Your team" subtitle={`${data.lead.code} · Campus lead · You earn a 5% bonus from KampusForce on your team's sales`}>
    <div className="trust-strip"><UsersRound size={18} /><span><strong>Recruit reps and help your team</strong> · Your bonus never comes out of your team's 80% or from the vendor.</span></div>
    <div className="metrics-grid"><Metric label="Active reps" value={data.members.length} note="On your campus" /><Metric label="Bonus earned" value={money(accrued)} note="Waiting for the next payout" tone="mustard" /><Metric label="Bonus paid" value={money(paid)} note="Before tax" tone="teal" /><Metric label="KampusForce's share" value={money(marginAfter)} note="After your bonus" /></div>
    <div className="team-layout">
      <Panel title="Team performance" action={<span className="result-count">You get 5% of your team's confirmed commission</span>}>
        {data.members.length ? <div className="table-wrap"><table><thead><tr><th>Rep</th><th>Status</th><th>Sales</th><th>Confirmed commission</th><th>Quality</th><th>Assigned</th></tr></thead><tbody>{data.members.map((row) => <tr key={row.member.id}><td><strong>{row.user.name}</strong><small className="table-sub mono">{row.member.code}</small></td><td><StateBadge state={row.member.status} /></td><td>{row.activations}</td><td><strong>{money(row.confirmedKobo)}</strong><small className="table-sub">Bonus based on</small></td><td>{row.member.qualityScore}/100</td><td>{shortDate(row.assignment.assignedAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No team members assigned" detail="Assign an active rep on your campus or record a recruiting invitation below." />}
      </Panel>
      <Panel title="Grow your team" className="recruit-panel">
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); recruit.mutate({ token, name, email, note: note || undefined }); }}><p className="eyebrow">INVITE A STUDENT</p><label>Recruit name<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} required /></label><label>Recruit email<input id="recruit-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Note <span className="optional">optional</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} /></label><button className="button primary" disabled={recruit.isPending}><UserPlus size={16} />Send invitation</button>{recruit.error && <p className="form-error">{recruit.error.message}</p>}</form>
        <form className="assign-form" onSubmit={(event) => { event.preventDefault(); assign.mutate({ token, repId: Number(repId) }); }}><label>Add a rep who's already active <span className="optional">Rep number</span><div className="inline-form"><input type="number" min="1" value={repId} onChange={(event) => setRepId(event.target.value)} required /><button className="button secondary" disabled={assign.isPending || !repId}>Add to team <ArrowRight size={14} /></button></div></label>{assign.error && <p className="form-error">{assign.error.message}</p>}</form>
        {notice && <p className="success-message"><CheckCircle2 size={16} />{notice}</p>}
        {inviteLink && <div className="invite-link"><label>Invitation link (works once)<input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></label><button className="button secondary small" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={14} />Copy link</button><small>Copy it now. It won't be shown again.</small></div>}
        {revoke.error && <p className="form-error">{revoke.error.message}</p>}
      </Panel>
    </div>
    <Panel title="Your team bonus" action={<span className="result-count"><CircleDollarSign size={14} /> Paid by KampusForce</span>}>
      {data.overrides.length ? <div className="table-wrap"><table><thead><tr><th>Sale / rep</th><th>Team commission</th><th>Your 5% bonus</th><th>KampusForce's share before</th><th>KampusForce's share after</th><th>State</th></tr></thead><tbody>{data.overrides.map(({ override, sourceRepCode }) => <tr key={override.id}><td><strong>#{override.dealId}</strong><small className="table-sub mono">{sourceRepCode}</small></td><td>{money(override.teamCommissionKobo)}</td><td><strong>{money(override.overrideKobo)}</strong></td><td>{money(override.platformMarginKobo)}</td><td>{money(override.platformMarginAfterKobo)}</td><td><StateBadge state={override.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No bonus yet" detail="When a rep on your team has a sale confirmed, you get 5% of their commission, paid by KampusForce. If it's refunded, the bonus is reversed." />}
    </Panel>
    <div className="team-lower"><Panel title="Invitations">{data.recruitments.length ? <div className="recruitment-list">{data.recruitments.map((recruit) => <div key={recruit.id}><UserPlus size={17} /><p><strong>{recruit.name}</strong><small>{(recruit.email || recruit.phoneE164)} · {shortDate(recruit.invitedAt)}</small>{recruit.note && <em>{recruit.note}</em>}</p><StateBadge state={recruit.status} />{["invited", "accepted"].includes(recruit.status) && <button className="icon-button" title="Cancel invitation" aria-label={`Revoke invitation for ${recruit.name}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ token, recruitmentId: recruit.id })}><X size={15} /></button>}</div>)}</div> : <EmptyState title="No invitations" detail="Invited students can't start until Operations has checked them." />}</Panel><Panel title="Good to know"><div className="contract-note"><ShieldCheck size={23} /><h3>Being a campus lead isn't a job.</h3><p>Operations chooses campus leads and activates new reps. Sending an invitation doesn't verify anyone, employ anyone or guarantee payment.</p><p>Campus leads come from the top 10% of reps, ranked on confirmed commission.</p></div></Panel></div>
  </WorkspaceLayout>;
}
