import { useMemo, useState } from "react";
import { CalendarClock, Check, FileCheck2, Plus, Save, Send, Sparkles } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { CrmInnovationWorkspace } from "./CrmInnovationWorkspace";

type SegmentFilters = { stage?: string; stalled?: boolean; query?: string };
const stages = ["targeted", "contacted", "qualified", "activation_pending", "won", "lost"] as const;

export function PipelineWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.pipeline.useQuery({ token });
  const me = trpc.rep.me.useQuery({ token }, { enabled: user.role === "rep" });
  const catalog = trpc.rep.catalog.useQuery({ token }, { enabled: user.role === "rep" });
  const [selectedId, setSelectedId] = useState(0);
  const [filters, setFilters] = useState<SegmentFilters>({});
  const [segmentName, setSegmentName] = useState("");
  const [alias, setAlias] = useState("");
  const [phone, setPhone] = useState("");
  const [productId, setProductId] = useState(0);
  const [nextAction, setNextAction] = useState("");
  const [activity, setActivity] = useState("");
  const [activityType, setActivityType] = useState<"note" | "call" | "meeting" | "message">("note");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [lostReason, setLostReason] = useState("");
  const refresh = () => utils.sales.pipeline.invalidate();
  const create = trpc.sales.createOpportunity.useMutation({ onSuccess: (result) => { setSelectedId(result.opportunityId); setAlias(""); setPhone(""); setNextAction(""); refresh(); } });
  const stage = trpc.sales.updateOpportunityStage.useMutation({ onSuccess: () => { setLostReason(""); refresh(); } });
  const addActivity = trpc.sales.addOpportunityActivity.useMutation({ onSuccess: () => { setActivity(""); refresh(); } });
  const createTask = trpc.sales.createOpportunityTask.useMutation({ onSuccess: () => { setTaskTitle(""); setTaskDue(""); refresh(); } });
  const taskState = trpc.sales.setOpportunityTaskState.useMutation({ onSuccess: refresh });
  const draft = trpc.sales.generateOutreachDraft.useMutation({ onSuccess: refresh });
  const outreach = trpc.sales.setOutreachState.useMutation({ onSuccess: refresh });
  const saveSegment = trpc.sales.saveCrmSegment.useMutation({ onSuccess: () => { setSegmentName(""); refresh(); } });
  const rows = useMemo(() => (query.data?.opportunities || []).filter((row) => (!filters.stage || row.opportunity.stage === filters.stage) && (!filters.stalled || row.stall.stalled) && (!filters.query || `${row.opportunity.alias} ${row.opportunity.opportunityRef} ${row.productName}`.toLowerCase().includes(filters.query.toLowerCase()))), [query.data, filters]);
  const selected = query.data?.opportunities.find((row) => row.opportunity.id === selectedId) || rows[0];
  if (query.isLoading || (user.role === "rep" && me.isLoading)) return <Loading label="Loading relationship pipeline…" />;
  if (query.error || me.error) return <ErrorState message={query.error?.message || me.error?.message || "Pipeline load failed"} retry={() => { query.refetch(); if (user.role === "rep") me.refetch(); }} />;
  const data = query.data!;
  const ownSelected = user.role === "rep" && selected?.opportunity.repId === me.data?.rep.id;
  const canEdit = ownSelected || ["ops", "admin"].includes(user.role);
  const errors = [create.error, stage.error, addActivity.error, createTask.error, taskState.error, draft.error, outreach.error, saveSegment.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><FileCheck2 size={18} /><p><strong>{data.boundary}</strong> Drafting and “mark shared” never send email, SMS or WhatsApp through KampusForce.</p></div>
    <div className="metrics-grid"><Metric label="Open opportunities" value={data.metrics.open} note={`${data.metrics.stalled} stalled or quiet`} tone={data.metrics.stalled ? "mustard" : "teal"} /><Metric label="Actions due" value={data.metrics.dueToday} note="Open tasks due within 24 hours" /><Metric label="Weighted forecast" value={money(data.metrics.weightedForecastKobo)} note={`${money(data.metrics.openExpectedKobo)} unweighted planning value`} tone="mustard" /><Metric label="Verified won rate" value={`${data.metrics.conversionRate}%`} note={`${data.metrics.won} closed-loop outcomes`} tone="teal" /></div>
    <Panel title="Pipeline focus and persistent segments" className="sales-filter-panel"><div className="sales-filters"><label>Search relationships<input value={filters.query || ""} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Alias, reference or product" /></label><label>Stage<select value={filters.stage || ""} onChange={(event) => setFilters({ ...filters, stage: event.target.value })}><option value="">All stages</option>{stages.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label className="check-filter"><input type="checkbox" checked={Boolean(filters.stalled)} onChange={(event) => setFilters({ ...filters, stalled: event.target.checked })} />Stalled only</label><form className="save-view-form" onSubmit={(event) => { event.preventDefault(); saveSegment.mutate({ token, name: segmentName, filters }); }}><label>Save segment<input required minLength={2} value={segmentName} onChange={(event) => setSegmentName(event.target.value)} placeholder="e.g. Quiet qualified leads" /></label><button className="button secondary" disabled={saveSegment.isPending}><Save size={14} />Save</button></form></div>{data.segments.length > 0 && <div className="saved-view-row"><span>Segments:</span>{data.segments.map((segment) => <button key={segment.id} onClick={() => setFilters(segment.filtersJson as SegmentFilters)}>{segment.name}</button>)}</div>}</Panel>
    {user.role === "rep" && <Panel title="Create a privacy-safe opportunity"><form className="sales-create-form" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, repId: me.data!.rep.id, productId: productId || catalog.data?.[0]?.product.id || 0, alias, customerPhone: phone || undefined, nextActionAt: nextAction ? new Date(nextAction) : undefined }); }}><label>Relationship alias<input required minLength={2} maxLength={120} value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="e.g. Final-year design student" /></label><label>Product<select value={productId} onChange={(event) => setProductId(Number(event.target.value))}>{(catalog.data || []).map((row) => <option key={row.product.id} value={row.product.id}>{row.product.name}</option>)}</select></label><label>Customer phone <span className="optional">optional; salted hash only</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Only with customer consent" /></label><label>Next action <span className="optional">optional</span><input type="datetime-local" value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label><button className="button primary" disabled={create.isPending || !catalog.data?.length}><Plus size={15} />Create opportunity</button></form></Panel>}
    <div className="pipeline-grid">
      <Panel title={`Relationship board · ${rows.length}`} className="pipeline-list">{rows.length ? rows.map((row) => <button key={row.opportunity.id} onClick={() => setSelectedId(row.opportunity.id)} className={selected?.opportunity.id === row.opportunity.id ? "pipeline-row selected" : "pipeline-row"}><span><strong>{row.opportunity.alias}</strong><small>{row.productName} · {row.repCode}</small></span><span className="pipeline-score">{row.opportunity.score}<small>fit score</small></span><StateBadge state={row.opportunity.stage} />{row.stall.stalled && <em>{row.stall.reason}</em>}</button>) : <EmptyState title="No relationships match" detail="Create an opportunity or clear the current segment filters." />}</Panel>
      <div>{selected ? <>
        <Panel title={selected.opportunity.alias} action={<StateBadge state={selected.opportunity.stage} />}>
          <div className="case-facts"><div><span>Reference</span><strong>{selected.opportunity.opportunityRef}</strong></div><div><span>Expected rep commission</span><strong>{money(selected.opportunity.expectedCommissionKobo)}</strong></div><div><span>Probability</span><strong>{selected.opportunity.probability}%</strong></div><div><span>Next action</span><strong>{shortDate(selected.opportunity.nextActionAt)}</strong></div></div>
          <div className="next-action"><span>Explainable score · {selected.opportunity.score}/100</span><strong>{selected.stall.stalled ? selected.stall.reason : "Relationship has a current activity record"}</strong><small>{selected.opportunity.scoreReasons.join(" · ")}</small></div>
          {canEdit && <div className="stage-actions">{stages.map((item) => <button key={item} className={selected.opportunity.stage === item ? "active" : ""} disabled={stage.isPending || (item === "lost" && lostReason.trim().length < 3)} onClick={() => stage.mutate({ token, opportunityId: selected.opportunity.id, stage: item, expectedVersion: selected.opportunity.version, lostReason: item === "lost" ? lostReason : undefined })}>{item.replaceAll("_", " ")}</button>)}</div>}
          {canEdit && <label>Loss reason <span className="optional">required before Lost</span><input value={lostReason} onChange={(event) => setLostReason(event.target.value)} placeholder="Suitability, price, timing or trust" /></label>}
          {canEdit && <form className="case-message-form" onSubmit={(event) => { event.preventDefault(); addActivity.mutate({ token, opportunityId: selected.opportunity.id, activityType, body: activity, nextActionAt: nextAction ? new Date(nextAction) : undefined }); }}><div className="form-row"><label>Activity type<select value={activityType} onChange={(event) => setActivityType(event.target.value as typeof activityType)}><option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="message">Message</option></select></label><label>Next action <span className="optional">optional</span><input type="datetime-local" value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label></div><label>Relationship context<textarea required minLength={2} value={activity} onChange={(event) => setActivity(event.target.value)} placeholder="What was requested, explained and agreed?" /></label><button className="button primary small" disabled={addActivity.isPending}>Record activity</button></form>}
          {canEdit && <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); createTask.mutate({ token, opportunityId: selected.opportunity.id, title: taskTitle, dueAt: new Date(taskDue) }); }}><label>Task<input required minLength={3} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Review activation requirements" /></label><label>Due<input required type="datetime-local" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label><button className="button secondary small" disabled={createTask.isPending}><CalendarClock size={14} />Schedule</button></form>}
          {data.tasks.filter((task) => task.opportunityId === selected.opportunity.id && task.state === "open").map((task) => <div className="task-row" key={task.id}><span><strong>{task.title}</strong><small>Due {shortDate(task.dueAt)}</small></span>{canEdit && <><button className="text-link" onClick={() => taskState.mutate({ token, taskId: task.id, state: "completed" })}><Check size={13} />Complete</button><button className="text-link" onClick={() => taskState.mutate({ token, taskId: task.id, state: "dismissed" })}>Dismiss</button></>}</div>)}
        </Panel>
        {canEdit && <Panel title="Human-approved contextual outreach" action={<button className="button secondary small" onClick={() => draft.mutate({ token, opportunityId: selected.opportunity.id })} disabled={draft.isPending}><Sparkles size={14} />Draft from history</button>}>{data.drafts.filter((item) => item.opportunityId === selected.opportunity.id).map((item) => <article className="outreach-draft" key={item.id}><StateBadge state={item.state} /><p>{item.body}</p><small>{item.rationale}</small><div>{item.state === "draft" && <><button className="button primary small" onClick={() => outreach.mutate({ token, draftId: item.id, action: "approve" })}>Approve draft</button><button className="button secondary small" onClick={() => outreach.mutate({ token, draftId: item.id, action: "dismiss" })}>Dismiss</button></>}{item.state === "approved" && <button className="button secondary small" onClick={() => outreach.mutate({ token, draftId: item.id, action: "mark_shared" })}><Send size={13} />Mark shared externally</button>}</div></article>)}{!data.drafts.some((item) => item.opportunityId === selected.opportunity.id) && <EmptyState title="No outreach drafts" detail="Generate a deterministic draft from this opportunity’s actual history. Nothing sends automatically." />}</Panel>}
        <Panel title="Complete relationship timeline"><div className="sales-timeline">{data.activities.filter((item) => item.opportunityId === selected.opportunity.id).map((item) => <article key={item.id}><span>{shortDate(item.createdAt)}</span><div><strong>{item.activityType.replaceAll("_", " ")}</strong><p>{item.body}</p></div></article>)}</div></Panel>
      </> : <Panel title="Relationship detail"><EmptyState title="Select an opportunity" detail="Its score, activities, tasks, drafts and outcome controls will appear here." /></Panel>}</div>
    </div>
    <CrmInnovationWorkspace />
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
