import { useState } from "react";
import { CheckCircle2, Megaphone, Pause, Play, Plus, Send, ShieldCheck, XCircle } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

const GOAL_LABEL: Record<string, string> = { activation: "Make sales", recruitment: "Recruit reps", training: "Pass lessons", reactivation: "Win back quiet reps" };
const EVENT_LABEL: Record<string, string> = {
  campaign_created: "Created", review_submitted: "Sent for approval", campaign_approved: "Approved", campaign_rejected: "Rejected",
  campaign_activated: "Started", campaign_paused: "Paused", in_app_notification_queued: "Rep notified", record_derived_conversion: "A rep reached the goal",
};

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
  const lessons = trpc.sales.trainingAdmin.useQuery({ token }, { enabled: ["ops", "admin"].includes(user.role) });
  const activeLessons = (lessons.data?.modules || []).filter((module) => module.active);
  const [lessonIds, setLessonIds] = useState<number[]>([]);
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
  const [creating, setCreating] = useState(false);
  const [reviewNote, setReviewNote] = useState("Audience, claims and in-app delivery boundary reviewed.");
  const refresh = () => utils.sales.campaigns.invalidate();
  const create = trpc.sales.createCampaign.useMutation({ onSuccess: () => { setCreating(false); setName(""); setMessage(""); setLessonIds([]); refresh(); utils.sales.trainingAdmin.invalidate(); } });
  const submit = trpc.sales.submitCampaignReview.useMutation({ onSuccess: refresh });
  const review = trpc.sales.reviewCampaign.useMutation({ onSuccess: refresh });
  const activate = trpc.sales.activateCampaign.useMutation({ onSuccess: refresh });
  const pause = trpc.sales.pauseCampaign.useMutation({ onSuccess: refresh });
  if (query.isLoading) return <Loading label="Loading campaigns…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  const errors = [create.error, submit.error, review.error, activate.error, pause.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.boundary}</strong> A creator cannot approve their own campaign.</p></div>
    <div className="metrics-grid"><Metric label="Campaigns" value={data.metrics.total} note={`${data.metrics.active} currently active`} /><Metric label="Awaiting review" value={data.metrics.awaitingReview} note="A second person must approve" tone={data.metrics.awaitingReview ? "mustard" : "teal"} /><Metric label="Reps enrolled" value={data.metrics.enrolled} note="Reps taking part" /><Metric label="Reached the goal" value={`${data.metrics.conversionRate}%`} note={`${data.metrics.converted} reps so far`} tone="teal" /></div>
    {canManage && !creating && <div className="panel-toolbar"><button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />New campaign</button></div>}
    {canManage && creating && <Panel title="New campaign" action={<button type="button" className="text-link" onClick={() => setCreating(false)}>Cancel</button>}><form className="campaign-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, name, goal, productId: productId || undefined, messageDraft: message, startsAt: new Date(startsAt), endsAt: new Date(endsAt), audienceRules: { minQualityScore: minQuality || undefined, requiredTrainingModuleKey: requiredTraining || undefined, includeCampusLeads: includeLeads }, trainingModuleIds: lessonIds }); }}><div className="form-row"><label>Campaign name<input required minLength={3} maxLength={180} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. August campus push" /></label><label>Goal<select value={goal} onChange={(event) => setGoal(event.target.value as typeof goal)}><option value="activation">Make sales</option><option value="recruitment">Recruit reps</option><option value="training">Pass lessons</option><option value="reactivation">Win back quiet reps</option></select></label></div><label>Product <span className="optional">optional</span><select value={productId} onChange={(event) => setProductId(Number(event.target.value))}><option value={0}>All eligible products</option>{(catalog.data || []).map((row) => <option key={row.product.id} value={row.product.id}>{row.product.name}</option>)}</select></label><label>Message to reps<textarea required minLength={10} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What reps should do and what they earn. Don't promise income or discounts the vendor hasn't offered." /></label><div className="form-row"><label>Starts<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Ends<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><div className="form-row"><label>Lowest rep rating (0–100)<input type="number" min={0} max={100} value={minQuality} onChange={(event) => setMinQuality(Number(event.target.value))} /></label><label>Only reps who already passed <span className="optional">optional</span><select value={requiredTraining} onChange={(event) => setRequiredTraining(event.target.value)}><option value="">Anyone eligible</option>{activeLessons.map((module) => <option key={module.id} value={module.moduleKey}>{module.title}</option>)}</select><small>Limits who joins. It doesn't assign the lesson.</small></label></div><fieldset className="campaign-lessons"><legend>Lessons for this campaign {goal === "training" ? <span className="required-mark">required for a training campaign</span> : <span className="optional">optional</span>}</legend><p className="panel-note">Reps who join get these lessons in Training.{goal === "training" ? " A rep counts as converted once they pass all of them." : ""}</p>{activeLessons.length ? <div className="campaign-lesson-list">{activeLessons.map((module) => <label className="contract-check" key={module.id}><input type="checkbox" checked={lessonIds.includes(module.id)} onChange={(event) => setLessonIds(event.target.checked ? [...lessonIds, module.id] : lessonIds.filter((x) => x !== module.id))} />{module.title}</label>)}</div> : <p className="panel-note">No lessons yet. Create one under Training.</p>}</fieldset><label className="contract-check"><input type="checkbox" checked={includeLeads} onChange={(event) => setIncludeLeads(event.target.checked)} />Include Campus Leads in the eligible audience</label><button className="button primary" disabled={create.isPending || (goal === "training" && !lessonIds.length)}><Megaphone size={15} />{create.isPending ? "Creating…" : "Create draft"}</button></form></Panel>}
    <div className="campaign-list">{data.campaigns.length ? data.campaigns.map((row) => { const campaign = row.campaign; const enrollments = data.enrollments.filter((item) => item.enrollment.campaignId === campaign.id); return <Panel key={campaign.id} title={campaign.name} action={<StateBadge state={campaign.state} />}><div className="campaign-heading"><span>{GOAL_LABEL[campaign.goal] || campaign.goal} · {row.productName || "All products"} · {row.campusName || "All campuses"}</span><span>{shortDate(campaign.startsAt)} → {shortDate(campaign.endsAt)}</span></div><p className="campaign-message">{campaign.messageDraft}</p>{row.lessons.length > 0 && <div className="training-chips">{row.lessons.map((lesson) => <span key={lesson.moduleId} className={lesson.active ? "training-chip campaign" : "training-chip muted"}>Lesson: {lesson.title}{lesson.active ? "" : " (archived)"}</span>)}</div>}<div className="campaign-stats"><span><strong>{enrollments.length}</strong> enrolled</span><span><strong>{enrollments.filter((item) => item.enrollment.state === "converted").length}</strong> reached the goal</span></div>{campaign.reviewNote && <p className="review-note">Review: {campaign.reviewNote}</p>}{canManage && <div className="case-actions">{["draft", "rejected"].includes(campaign.state) && <button className="button secondary small" onClick={() => submit.mutate({ token, campaignId: campaign.id, expectedVersion: campaign.version })} disabled={submit.isPending}><Send size={14} />Send for approval</button>}{campaign.state === "pending_review" && <><button className="button primary small" onClick={() => review.mutate({ token, campaignId: campaign.id, decision: "approved", note: reviewNote })} disabled={review.isPending}><CheckCircle2 size={14} />Approve</button><button className="button secondary small" onClick={() => review.mutate({ token, campaignId: campaign.id, decision: "rejected", note: reviewNote })} disabled={review.isPending}><XCircle size={14} />Reject</button></>}{["approved", "scheduled", "paused"].includes(campaign.state) && <button className="button primary small" onClick={() => activate.mutate({ token, campaignId: campaign.id })} disabled={activate.isPending}><Play size={14} />Start campaign</button>}{campaign.state === "active" && <button className="button secondary small" onClick={() => pause.mutate({ token, campaignId: campaign.id })} disabled={pause.isPending}><Pause size={14} />Pause</button>}</div>}</Panel>; }) : <Panel title="Campaigns"><EmptyState title="No campaigns yet" detail={canManage ? "Create a campaign, send it for approval by someone else in Operations, then start it." : user.role === "vendor" ? "Campaigns Operations runs for your products will show here." : "When Operations adds you to a campaign, it shows here."} /></Panel>}</div>
    {data.events.length > 0 && <Panel title="Campaign history"><div className="sales-timeline">{data.events.slice(0, 20).map((event) => <article key={event.id}><span>{shortDate(event.createdAt)}</span><div><strong>{EVENT_LABEL[event.eventType] || event.eventType.replaceAll("_", " ")}</strong><p>{data.campaigns.find((row) => row.campaign.id === event.campaignId)?.campaign.name || `Campaign #${event.campaignId}`}</p></div></article>)}</div></Panel>}
    {canManage && data.campaigns.some((row) => row.campaign.state === "pending_review") && <label className="review-note-input">Review note<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} minLength={3} maxLength={1000} /></label>}
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
