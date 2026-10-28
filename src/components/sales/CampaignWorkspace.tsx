import { useState } from "react";
import { CheckCircle2, Megaphone, Pause, Play, Send, ShieldCheck, XCircle } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

function localInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const DEFAULT_STARTS_AT = localInput(new Date(Date.now() - 60_000));
const DEFAULT_ENDS_AT = localInput(new Date(Date.now() + 7 * 86_400_000));

export function CampaignWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.campaigns.useQuery({ token });
  const catalog = trpc.rep.catalog.useQuery({ token }, { enabled: ["ops", "admin"].includes(user.role) });
  const canManage = ["ops", "admin"].includes(user.role);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<"activation" | "recruitment" | "training" | "reactivation">("activation");
  const [productId, setProductId] = useState(0);
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState(DEFAULT_STARTS_AT);
  const [endsAt, setEndsAt] = useState(DEFAULT_ENDS_AT);
  const [minQuality, setMinQuality] = useState(0);
  const [requiredTraining, setRequiredTraining] = useState("");
  const [includeLeads, setIncludeLeads] = useState(true);
  const [reviewNote, setReviewNote] = useState("Audience, claims and in-app delivery boundary reviewed.");
  const refresh = () => utils.sales.campaigns.invalidate();
  const create = trpc.sales.createCampaign.useMutation({ onSuccess: () => { setName(""); setMessage(""); refresh(); } });
  const submit = trpc.sales.submitCampaignReview.useMutation({ onSuccess: refresh });
  const review = trpc.sales.reviewCampaign.useMutation({ onSuccess: refresh });
  const activate = trpc.sales.activateCampaign.useMutation({ onSuccess: refresh });
  const pause = trpc.sales.pauseCampaign.useMutation({ onSuccess: refresh });
  if (query.isLoading) return <Loading label="Loading campaign control tower…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  const errors = [create.error, submit.error, review.error, activate.error, pause.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.boundary}</strong> A creator cannot approve their own campaign.</p></div>
    <div className="metrics-grid"><Metric label="Campaigns" value={data.metrics.total} note={`${data.metrics.active} currently active`} /><Metric label="Awaiting review" value={data.metrics.awaitingReview} note="Independent four-eyes gate" tone={data.metrics.awaitingReview ? "mustard" : "teal"} /><Metric label="Enrollments" value={data.metrics.enrolled} note="Deduplicated campaign/rep pairs" /><Metric label="Record-derived conversion" value={`${data.metrics.conversionRate}%`} note={`${data.metrics.converted} later verified outcomes`} tone="teal" /></div>
    {canManage && <Panel title="Draft a controlled campaign"><form className="campaign-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, name, goal, productId: productId || undefined, messageDraft: message, startsAt: new Date(startsAt), endsAt: new Date(endsAt), audienceRules: { minQualityScore: minQuality || undefined, requiredTrainingModuleKey: requiredTraining || undefined, includeCampusLeads: includeLeads } }); }}><div className="form-row"><label>Campaign name<input required minLength={3} maxLength={180} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. August activation readiness" /></label><label>Goal<select value={goal} onChange={(event) => setGoal(event.target.value as typeof goal)}><option value="activation">Activation</option><option value="recruitment">Recruitment</option><option value="training">Training</option><option value="reactivation">Reactivation</option></select></label></div><label>Product scope <span className="optional">optional</span><select value={productId} onChange={(event) => setProductId(Number(event.target.value))}><option value={0}>All eligible products</option>{(catalog.data || []).map((row) => <option key={row.product.id} value={row.product.id}>{row.product.name}</option>)}</select></label><label>Approved-message draft<textarea required minLength={10} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="State the actual goal and vendor terms. No guaranteed income, invented discount or external delivery claim." /></label><div className="form-row"><label>Starts<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Ends<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><div className="form-row"><label>Minimum rep quality<input type="number" min={0} max={100} value={minQuality} onChange={(event) => setMinQuality(Number(event.target.value))} /></label><label>Required training <span className="optional">optional module key</span><select value={requiredTraining} onChange={(event) => setRequiredTraining(event.target.value)}><option value="">No training gate</option><option value="ethical-sales-foundations">Ethical sales foundations</option><option value="privacy-vendor-kyc-boundary">Privacy and vendor KYC boundary</option><option value="consultative-opportunity-management">Consultative opportunity management</option></select></label></div><label className="contract-check"><input type="checkbox" checked={includeLeads} onChange={(event) => setIncludeLeads(event.target.checked)} />Include Campus Leads in the eligible audience</label><button className="button primary" disabled={create.isPending}><Megaphone size={15} />Create draft</button></form></Panel>}
    <div className="campaign-list">{data.campaigns.length ? data.campaigns.map((row) => { const campaign = row.campaign; const enrollments = data.enrollments.filter((item) => item.enrollment.campaignId === campaign.id); return <Panel key={campaign.id} title={campaign.name} action={<StateBadge state={campaign.state} />}><div className="campaign-heading"><span className="mono">{campaign.campaignKey}</span><span>{campaign.goal.replaceAll("_", " ")} · {row.productName || "All products"} · {row.campusName || "All campuses"}</span><span>{shortDate(campaign.startsAt)} → {shortDate(campaign.endsAt)}</span></div><p className="campaign-message">{campaign.messageDraft}</p><div className="campaign-stats"><span><strong>{enrollments.length}</strong> enrolled</span><span><strong>{enrollments.filter((item) => item.enrollment.state === "converted").length}</strong> converted</span><span><strong>v{campaign.version}</strong> optimistic version</span></div>{campaign.reviewNote && <p className="review-note">Review: {campaign.reviewNote}</p>}{canManage && <div className="case-actions">{["draft", "rejected"].includes(campaign.state) && <button className="button secondary small" onClick={() => submit.mutate({ token, campaignId: campaign.id, expectedVersion: campaign.version })} disabled={submit.isPending}><Send size={14} />Submit for independent review</button>}{campaign.state === "pending_review" && <><button className="button primary small" onClick={() => review.mutate({ token, campaignId: campaign.id, decision: "approved", note: reviewNote })} disabled={review.isPending}><CheckCircle2 size={14} />Approve independently</button><button className="button secondary small" onClick={() => review.mutate({ token, campaignId: campaign.id, decision: "rejected", note: reviewNote })} disabled={review.isPending}><XCircle size={14} />Reject</button></>}{["approved", "scheduled", "paused"].includes(campaign.state) && <button className="button primary small" onClick={() => activate.mutate({ token, campaignId: campaign.id })} disabled={activate.isPending}><Play size={14} />Activate in window</button>}{campaign.state === "active" && <button className="button secondary small" onClick={() => pause.mutate({ token, campaignId: campaign.id })} disabled={pause.isPending}><Pause size={14} />Pause</button>}</div>}</Panel>; }) : <Panel title="Campaign register"><EmptyState title="No campaigns visible" detail={canManage ? "Draft a campaign, submit it for independent review, then activate inside its window." : "Approved campaign enrollments will appear here; no external messages are sent."} /></Panel>}</div>
    {data.events.length > 0 && <Panel title="Campaign evidence"><div className="sales-timeline">{data.events.slice(0, 30).map((event) => <article key={event.id}><span>{shortDate(event.createdAt)}</span><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>Campaign #{event.campaignId} · {Object.entries(event.metadataJson).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "Recorded event"}</p></div></article>)}</div></Panel>}
    {canManage && data.campaigns.some((row) => row.campaign.state === "pending_review") && <label className="review-note-input">Review note<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} minLength={3} maxLength={1000} /></label>}
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
