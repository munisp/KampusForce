import { useMemo, useState } from "react";
import { CheckCircle2, CirclePause, CirclePlay, ExternalLink, FileCheck2, Link2, Megaphone, RefreshCw, Send, ShieldCheck, Square, UserPlus, UsersRound, XCircle } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

function localInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const DEFAULT_STARTS_AT = localInput(new Date(Date.now() - 60_000));
const DEFAULT_ENDS_AT = localInput(new Date(Date.now() + 14 * 86_400_000));

function ProgressBar({ value, label }: { value: number; label: string }) {
  return <div className="promotion-progress" aria-label={`${label}: ${value}%`}><div><span>{label}</span><strong>{value}%</strong></div><span className="promotion-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span></div>;
}

export function PromotionWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.promotion.workspace.useQuery({ token });
  const [selectedId, setSelectedId] = useState(0);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState(0);
  const [campusId, setCampusId] = useState(0);
  const [brief, setBrief] = useState("");
  const [budgetNaira, setBudgetNaira] = useState(100_000);
  const [recruitmentTarget, setRecruitmentTarget] = useState(10);
  const [warningPct, setWarningPct] = useState(80);
  const [startsAt, setStartsAt] = useState(DEFAULT_STARTS_AT);
  const [endsAt, setEndsAt] = useState(DEFAULT_ENDS_AT);
  const [reviewNote, setReviewNote] = useState("Promotion claims, budget, audience, recruitment controls and verified-outcome boundary reviewed.");
  const [linkResult, setLinkResult] = useState<{ promotionId: number; url: string; qr: string } | null>(null);
  const [inviteResult, setInviteResult] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteConsent, setInviteConsent] = useState(false);
  const [customerRef, setCustomerRef] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "whatsapp">("email");
  const [consentState, setConsentState] = useState<"consented" | "suppressed">("consented");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [policyVersion, setPolicyVersion] = useState("privacy-v1.0");
  const [deliveryResult, setDeliveryResult] = useState("");
  const refresh = () => utils.promotion.workspace.invalidate();
  const create = trpc.promotion.create.useMutation({ onSuccess: () => { setName(""); setBrief(""); refresh(); } });
  const submit = trpc.promotion.submit.useMutation({ onSuccess: refresh });
  const review = trpc.promotion.review.useMutation({ onSuccess: refresh });
  const changeState = trpc.promotion.changeState.useMutation({ onSuccess: refresh });
  const setTrigger = trpc.promotion.setTrigger.useMutation({ onSuccess: refresh });
  const runSweep = trpc.promotion.runSweep.useMutation({ onSuccess: refresh });
  const createLink = trpc.promotion.createLink.useMutation({ onSuccess: (result, input) => setLinkResult({ promotionId: input.promotionId, url: result.url, qr: result.qr }) });
  const invite = trpc.promotion.invite.useMutation({ onSuccess: (result) => { setInviteResult(`${window.location.origin}${result.acceptancePath}`); setInviteName(""); setInvitePhone(""); setInviteNote(""); setInviteConsent(false); refresh(); } });
  const consent = trpc.promotion.consent.useMutation({ onSuccess: () => { setCustomerRef(""); setEvidenceRef(""); refresh(); } });
  const delivery = trpc.promotion.requestDelivery.useMutation({ onSuccess: (result) => { setDeliveryResult(`Sandbox simulation ${result.deliveryRequestId}: ${result.consentedCount} consented, ${result.suppressedCount} suppressed. No external request was made.`); refresh(); } });
  const canDraft = ["vendor", "ops", "admin"].includes(user.role);
  const canOperate = ["ops", "admin"].includes(user.role);
  const selected = useMemo(() => query.data?.promotions.find((row) => row.promotion.id === selectedId) || query.data?.promotions[0], [query.data, selectedId]);
  if (query.isLoading) return <Loading label="Loading vendor promotion orchestration…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  const errors = [create.error, submit.error, review.error, changeState.error, setTrigger.error, runSweep.error, createLink.error, invite.error, consent.error, delivery.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.boundary}</strong></p></div>
    <div className="metrics-grid">
      <Metric label="Vendor promotions" value={data.metrics.total} note={`${data.metrics.active} accepting verified acquisition`} />
      <Metric label="Recruitment staffing" value={`${data.metrics.activatedRecruits}/${data.metrics.recruitmentTarget}`} note="Activated after identity and student gates" tone="teal" />
      <Metric label="Confirmed activations" value={data.metrics.confirmedActivations} note="Vendor-verified deals, not clicks" tone="teal" />
      <Metric label={data.metrics.committedKobo === null ? "Independent review" : "Committed budget"} value={data.metrics.committedKobo === null ? data.metrics.awaitingReview : money(data.metrics.committedKobo)} note={data.metrics.committedKobo === null ? "Operational control queue" : `${data.metrics.awaitingReview} awaiting review`} tone={data.metrics.awaitingReview ? "mustard" : "default"} />
    </div>

    {canDraft && <Panel title="Draft an external vendor promotion">
      <form className="campaign-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, name, productId, campusId: campusId || undefined, brief, budgetCapKobo: Math.round(budgetNaira * 100), recruitmentTarget, staffingWarningPct: warningPct, startsAt: new Date(startsAt), endsAt: new Date(endsAt) }); }}>
        <div className="form-row"><label>Promotion name<input required minLength={3} maxLength={180} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Back-to-campus data bundle" /></label><label>Product<select required value={productId} onChange={(event) => setProductId(Number(event.target.value))}><option value={0} disabled>Select an active product</option>{data.options.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.vendorRef}</option>)}</select></label></div>
        <label>Customer promotion brief<textarea required minLength={20} maxLength={6000} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Describe the actual customer offer, eligibility, vendor landing journey and activation evidence. Do not promise unapproved discounts or representative income." /></label>
        <div className="form-row three"><label>Budget cap (₦)<input required type="number" min={1} value={budgetNaira} onChange={(event) => setBudgetNaira(Number(event.target.value))} /><small>Caps new promotion commissions; does not reserve escrow.</small></label><label>Activated-recruit target<input required type="number" min={1} max={10000} value={recruitmentTarget} onChange={(event) => setRecruitmentTarget(Number(event.target.value))} /></label><label>Staffing risk threshold (%)<input required type="number" min={50} max={100} value={warningPct} onChange={(event) => setWarningPct(Number(event.target.value))} /></label></div>
        <div className="form-row three"><label>Campus scope<select value={campusId} onChange={(event) => setCampusId(Number(event.target.value))}><option value={0}>All eligible campuses</option>{data.options.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label><label>Starts<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Ends<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
        <button className="button primary" disabled={create.isPending || !productId}><Megaphone size={15} />Create controlled draft</button>
      </form>
    </Panel>}

    {canOperate && <div className="promotion-ops-bar"><span>Scheduled transitions, staffing risk and capacity stops run through the durable worker.</span><button className="button secondary small" onClick={() => runSweep.mutate({ token })} disabled={runSweep.isPending}><RefreshCw size={14} />Run orchestration sweep</button></div>}

    <div className="promotion-list">
      {data.promotions.length ? data.promotions.map((row) => {
        const promotion = row.promotion;
        const report = row.report;
        const consentMetric = data.consentMetrics.find((item) => item.promotionId === promotion.id);
        return <Panel key={promotion.id} title={promotion.name} action={<StateBadge state={promotion.state} />} className={selected?.promotion.id === promotion.id ? "promotion-card selected" : "promotion-card"}>
          <button className="promotion-select" onClick={() => setSelectedId(promotion.id)} aria-label={`Select ${promotion.name}`}><span className="mono">{promotion.promotionKey}</span><span>{row.vendorName} · {row.productName}</span><span>{row.campusName || "All campuses"} · {shortDate(promotion.startsAt)} → {shortDate(promotion.endsAt)}</span></button>
          <p className="campaign-message">{promotion.brief}</p>
          <div className="promotion-outcomes"><span><strong>{report.attributedCustomers}</strong><small>first-touch customers</small></span><span><strong>{report.confirmedActivations}</strong><small>confirmed outcomes</small></span><span><strong>{report.recruitment.activated}/{report.recruitment.target}</strong><small>activated recruits</small></span><span><strong>{report.signedLinks}</strong><small>signed links</small></span></div>
          <ProgressBar value={report.recruitment.progressPct} label={`Staffing · ${report.recruitment.invited} invited, ${report.recruitment.accepted} accepted`} />
          {report.budget && <><ProgressBar value={report.budget.capKobo ? Math.min(100, Math.round(report.budget.committedKobo / report.budget.capKobo * 100)) : 0} label={`Budget · ${money(report.budget.committedKobo)} of ${money(report.budget.capKobo)}`} /><div className="promotion-budget-note"><span>{money(report.budget.remainingKobo)} budget headroom</span><span>{money(report.budget.uncommittedEscrowKobo)} uncommitted escrow</span><span>No double reservation</span></div></>}
          {consentMetric && <p className="panel-note">Consented audience: {consentMetric.consented} · suppressed: {consentMetric.suppressed}. Raw contact details are not returned.</p>}
          {promotion.reviewNote && <p className="review-note">Review: {promotion.reviewNote}</p>}
          <div className="case-actions">
            {row.capabilities.canSubmit && <button className="button secondary small" onClick={() => submit.mutate({ token, promotionId: promotion.id, expectedVersion: promotion.version })} disabled={submit.isPending}><Send size={14} />Submit for review</button>}
            {row.capabilities.canReview && <><button className="button primary small" onClick={() => review.mutate({ token, promotionId: promotion.id, decision: "approved", note: reviewNote })} disabled={review.isPending}><CheckCircle2 size={14} />Approve independently</button><button className="button secondary small" onClick={() => review.mutate({ token, promotionId: promotion.id, decision: "rejected", note: reviewNote })} disabled={review.isPending}><XCircle size={14} />Reject</button></>}
            {row.capabilities.canStart && <button className="button primary small" onClick={() => changeState.mutate({ token, promotionId: promotion.id, action: "start" })} disabled={changeState.isPending}><CirclePlay size={14} />Start</button>}
            {row.capabilities.canPause && <button className="button secondary small" onClick={() => changeState.mutate({ token, promotionId: promotion.id, action: "pause" })} disabled={changeState.isPending}><CirclePause size={14} />Pause acquisition & recruiting</button>}
            {row.capabilities.canResume && <button className="button primary small" onClick={() => changeState.mutate({ token, promotionId: promotion.id, action: "resume" })} disabled={changeState.isPending}><CirclePlay size={14} />Resume after capacity check</button>}
            {row.capabilities.canEnd && <button className="button secondary small" onClick={() => changeState.mutate({ token, promotionId: promotion.id, action: "end" })} disabled={changeState.isPending}><Square size={14} />End, preserve history</button>}
            {row.capabilities.canLink && <button className="button primary small" onClick={() => createLink.mutate({ token, promotionId: promotion.id })} disabled={createLink.isPending}><Link2 size={14} />Create signed link & QR</button>}
          </div>
          {linkResult?.promotionId === promotion.id && <div className="promotion-link-result"><img src={linkResult.qr} alt={`Signed QR for ${promotion.name}`} /><div><strong>Promotion-scoped first-touch link</strong><p>No customer data is embedded in this URL. Existing first-touch records are never reassigned.</p><label>Signed acquisition URL<input readOnly value={linkResult.url} onFocus={(event) => event.target.select()} /></label><a className="button secondary small" href={linkResult.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open vendor handoff</a></div></div>}
        </Panel>;
      }) : <EmptyState title="No vendor promotions yet" detail={canDraft ? "Draft a customer promotion to trigger a controlled internal recruitment campaign after independent approval." : "Approved vendor promotions and their verified outcomes will appear here."} />}
    </div>

    {canOperate && data.promotions.some((row) => row.capabilities.canReview) && <label className="review-note-input">Independent review note<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} minLength={3} maxLength={1000} /></label>}

    {selected && <div className="promotion-detail-grid">
      {canOperate && <Panel title={`Trigger rules · ${selected.promotion.promotionKey}`}><div className="promotion-rule-list">{data.rules.filter((rule) => rule.promotionId === selected.promotion.id).map((rule) => <article key={rule.id}><div><strong>{rule.eventType}</strong><span>{rule.action.replaceAll("_", " ")}</span></div><button className={rule.enabled ? "button secondary small" : "button primary small"} onClick={() => setTrigger.mutate({ token, ruleId: rule.id, enabled: !rule.enabled })} disabled={setTrigger.isPending}>{rule.enabled ? "Disable" : "Enable"}</button></article>)}</div></Panel>}
      {selected.capabilities.canRecruit && <Panel title={`Recruit for ${selected.promotion.name}`}><form className="campaign-form" onSubmit={(event) => { event.preventDefault(); invite.mutate({ token, promotionId: selected.promotion.id, name: inviteName, phone: invitePhone, note: inviteNote || undefined, consentConfirmed: true }); }}><label>Candidate name<input required minLength={3} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label><label>Consented phone<input required value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="+234…" /></label><label>Recruitment context <span className="optional">no identity documents</span><textarea maxLength={500} value={inviteNote} onChange={(event) => setInviteNote(event.target.value)} /></label><label className="contract-check"><input required type="checkbox" checked={inviteConsent} onChange={(event) => setInviteConsent(event.target.checked)} />The candidate consented to this invitation</label><button className="button primary" disabled={invite.isPending}><UserPlus size={15} />Create promotion invitation</button><p className="panel-note">Recruitment creates no commission. Existing onboarding continues if new invitations later stop.</p></form>{inviteResult && <label className="invite-link">Candidate acceptance URL<input readOnly value={inviteResult} onFocus={(event) => event.target.select()} /></label>}</Panel>}
      {user.role === "rep" && data.viewer.isCampusLead && data.recruitments.filter((item) => item.campaignId === selected.promotion.recruitmentCampaignId).length > 0 && <Panel title="Promotion recruitment queue"><div className="promotion-recruit-queue">{data.recruitments.filter((item) => item.campaignId === selected.promotion.recruitmentCampaignId).map((item) => <article key={item.id}><div><strong>{item.name}</strong><StateBadge state={item.status} /></div><span>Invited {shortDate(item.invitedAt)}{item.activatedAt ? ` · activated ${shortDate(item.activatedAt)}` : ""}</span></article>)}</div></Panel>}
      {selected.capabilities.canConsent && <Panel title={`Consent & delivery · ${selected.promotion.promotionKey}`}><form className="campaign-form" onSubmit={(event) => { event.preventDefault(); consent.mutate({ token, promotionId: selected.promotion.id, customerRef, channel, state: consentState, evidenceRef, policyVersion }); }}><div className="form-row"><label>Customer reference<input required minLength={3} maxLength={160} value={customerRef} onChange={(event) => setCustomerRef(event.target.value)} placeholder="Vendor customer reference; stored only as a hash" /></label><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></label></div><div className="form-row"><label>Consent state<select value={consentState} onChange={(event) => setConsentState(event.target.value as typeof consentState)}><option value="consented">Consented</option><option value="suppressed">Suppressed</option></select></label><label>Opaque evidence reference<input required minLength={3} maxLength={240} value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="e.g. consent-batch-2026-10-A" /></label></div><label>Policy version<input required value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)} /></label><button className="button secondary" disabled={consent.isPending}><FileCheck2 size={15} />Record hashed consent state</button></form><div className="case-actions"><button className="button primary small" onClick={() => delivery.mutate({ token, promotionId: selected.promotion.id, channel, mode: "sandbox" })} disabled={delivery.isPending}><Send size={14} />Simulate consented delivery</button><button className="button secondary small" onClick={() => delivery.mutate({ token, promotionId: selected.promotion.id, channel, mode: "live" })} disabled={delivery.isPending}><ShieldCheck size={14} />Check live-provider gate</button></div>{deliveryResult && <p className="success-note">{deliveryResult}</p>}<p className="panel-note">A simulation records audience and suppression evidence only. It does not send email, SMS or WhatsApp.</p></Panel>}
      <Panel title="Verified reporting boundary"><div className="promotion-definition"><UsersRound size={22} /><p><strong>Two outcomes, separately evidenced.</strong> Recruitment counts only after the existing representative activation path. Customer outcomes count only after signed first-touch attribution and vendor-verified activation. Pending deals are not reported as confirmed.</p></div></Panel>
    </div>}

    {data.events.length > 0 && <Panel title="Promotion & recruitment evidence"><div className="sales-timeline">{data.events.slice(0, 35).map((event) => <article key={event.id}><span>{shortDate(event.createdAt)}</span><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>Promotion #{event.promotionId}{user.role !== "rep" ? ` · ${Object.entries(event.metadataJson).slice(0, 6).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}` : ""}</p></div></article>)}</div></Panel>}
    {canOperate && data.orchestration.length > 0 && <Panel title="Durable orchestration receipts"><div className="promotion-receipts">{data.orchestration.slice(0, 25).map((event) => <article key={event.id}><span className="mono">#{event.id}</span><div><strong>{event.eventType}</strong><small>{event.eventKey}</small></div><StateBadge state={event.state} /><span>{event.attempts} attempts · {shortDate(event.updatedAt)}</span>{event.lastError && <p>{event.lastError}</p>}</article>)}</div></Panel>}
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
