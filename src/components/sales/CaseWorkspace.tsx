import { useMemo, useState } from "react";
import { AlarmClock, Eye, EyeOff, Link2, MessageSquareText, RotateCcw, Save, UserRoundCheck } from "lucide-react";
import { EmptyState, Metric, Panel } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type CaseFilters = { query?: string; state?: string; unassigned?: boolean };

export function CaseWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.sales.cases.useQuery({ token });
  const [selectedId, setSelectedId] = useState(0);
  const [filters, setFilters] = useState<CaseFilters>({ state: "open" });
  const [viewName, setViewName] = useState("");
  const [message, setMessage] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [snoozeNote, setSnoozeNote] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [linkType, setLinkType] = useState<"related" | "duplicate" | "blocks">("related");
  const [assignee, setAssignee] = useState("");
  const refresh = () => utils.sales.cases.invalidate();
  const mutation = { onSuccess: refresh } as const;
  const assign = trpc.sales.assignCase.useMutation(mutation);
  const addMessage = trpc.sales.addCaseMessage.useMutation({ onSuccess: () => { setMessage(""); refresh(); } });
  const snooze = trpc.sales.snoozeCase.useMutation({ onSuccess: () => { setSnoozeUntil(""); setSnoozeNote(""); refresh(); } });
  const reopen = trpc.sales.reopenCase.useMutation({ onSuccess: () => { setReopenReason(""); refresh(); } });
  const link = trpc.sales.linkCases.useMutation({ onSuccess: () => { setRelatedId(""); refresh(); } });
  const watch = trpc.sales.watchCase.useMutation(mutation);
  const saveView = trpc.sales.saveCaseView.useMutation({ onSuccess: () => { setViewName(""); refresh(); } });
  const cases = useMemo(() => (query.data?.cases || []).filter((row) => {
    const needle = filters.query?.toLowerCase() || "";
    const matchesText = !needle || `${row.ticket.ticketRef} ${row.ticket.subject} ${row.vendorName} ${row.repCode}`.toLowerCase().includes(needle);
    const matchesState = !filters.state || (filters.state === "open" ? !["resolved", "closed"].includes(row.ticket.state) : row.ticket.state === filters.state);
    return matchesText && matchesState && (!filters.unassigned || !row.ticket.assigneeUserId);
  }), [query.data, filters]);
  const selected = query.data?.cases.find((row) => row.ticket.id === selectedId) || cases[0];
  if (query.isLoading) return <Loading label="Loading case command…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  const errors = [assign.error, addMessage.error, snooze.error, reopen.error, link.error, watch.error, saveView.error].filter(Boolean);
  return <>
    <div className="sandbox-banner"><MessageSquareText size={18} /><p><strong>{data.boundary}</strong> Public replies and staff notes are separated; representatives never receive internal staff notes.</p></div>
    <div className="metrics-grid"><Metric label="Open cases" value={data.metrics.open} note={`${data.metrics.unassigned} need a named owner`} /><Metric label="First response overdue" value={data.metrics.firstResponseOverdue} note="Fresh clocks also start on reopen" tone={data.metrics.firstResponseOverdue ? "danger" : "teal"} /><Metric label="Resolution overdue" value={data.metrics.breached} note="Active queue SLA exposure" tone={data.metrics.breached ? "danger" : "default"} /><Metric label="Snoozed / reopened" value={`${data.metrics.snoozed} / ${data.metrics.reopened}`} note="Timed waiting and preserved history" tone="mustard" /></div>
    <Panel title="Queues and saved views" className="sales-filter-panel">
      <div className="sales-filters"><label>Search cases<input value={filters.query || ""} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Reference, subject, vendor or rep" /></label><label>Queue state<select value={filters.state || ""} onChange={(event) => setFilters({ ...filters, state: event.target.value })}><option value="open">All open</option><option value="">All states</option>{["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue", "resolved", "closed"].map((state) => <option key={state} value={state}>{state.replaceAll("_", " ")}</option>)}</select></label><label className="check-filter"><input type="checkbox" checked={Boolean(filters.unassigned)} onChange={(event) => setFilters({ ...filters, unassigned: event.target.checked })} />Unassigned only</label><form className="save-view-form" onSubmit={(event) => { event.preventDefault(); saveView.mutate({ token, name: viewName, filters }); }}><label>Save current view<input required minLength={2} maxLength={100} value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="e.g. Urgent unowned" /></label><button className="button secondary" disabled={saveView.isPending}><Save size={14} />Save</button></form></div>
      {data.savedViews.length > 0 && <div className="saved-view-row"><span>Saved:</span>{data.savedViews.map((view) => <button key={view.id} onClick={() => setFilters(view.filtersJson as CaseFilters)}>{view.name}</button>)}</div>}
    </Panel>
    <div className="sales-case-grid">
      <Panel title={`Case queue · ${cases.length}`} className="sales-case-list">{cases.length ? cases.map((row) => <button key={row.ticket.id} className={selected?.ticket.id === row.ticket.id ? "sales-case-row selected" : "sales-case-row"} onClick={() => { setSelectedId(row.ticket.id); setAssignee(row.ticket.assigneeUserId ? String(row.ticket.assigneeUserId) : ""); }}><span className="mono">{row.ticket.ticketRef}</span><strong>{row.ticket.subject}</strong><small>{row.vendorName} · {row.repCode}</small><span className="sales-case-risk"><StateBadge state={row.ticket.state} /><em>Risk {row.risk.score}</em></span></button>) : <EmptyState title="No cases match" detail="Change the filters or save a different operating view." />}</Panel>
      <div>{selected ? <>
        <Panel title={selected.ticket.subject} action={<StateBadge state={selected.ticket.state} />}>
          <div className="case-facts"><div><span>Owner</span><strong>{selected.assigneeName || "Unassigned"}</strong></div><div><span>First response</span><strong>{selected.ticket.firstRespondedAt ? shortDate(selected.ticket.firstRespondedAt) : shortDate(selected.ticket.firstResponseDueAt)}</strong></div><div><span>Resolution due</span><strong>{shortDate(selected.ticket.slaDueAt)}</strong></div><div><span>Snoozed until</span><strong>{shortDate(selected.ticket.snoozedUntil)}</strong></div></div>
          <div className="next-action"><span>Deterministic next action</span><strong>{selected.guidance}</strong><small>{selected.risk.reasons.join(" · ")}</small></div>
          <p className="case-description">{selected.ticket.description}</p>
          <div className="case-action-grid">
            <form onSubmit={(event) => { event.preventDefault(); assign.mutate({ token, ticketId: selected.ticket.id, assigneeUserId: assignee ? Number(assignee) : null, expectedVersion: selected.ticket.version }); }}><label>Named owner<select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Unassigned</option>{data.assignees.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.role}</option>)}</select></label><button className="button secondary small" disabled={assign.isPending}><UserRoundCheck size={14} />Apply owner</button></form>
            <button className="button secondary small" onClick={() => watch.mutate({ token, ticketId: selected.ticket.id, watching: !selected.watching })} disabled={watch.isPending}>{selected.watching ? <EyeOff size={14} /> : <Eye size={14} />}{selected.watching ? "Stop watching" : "Watch case"}</button>
          </div>
          {!["resolved", "closed"].includes(selected.ticket.state) ? <>
            <form className="case-message-form" onSubmit={(event) => { event.preventDefault(); addMessage.mutate({ token, ticketId: selected.ticket.id, visibility, body: message }); }}><div className="form-row"><label>Collaboration type<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">Public reply</option>{user.role !== "rep" && <option value="internal">Internal staff note</option>}</select></label><label>Timed snooze<input type="datetime-local" value={snoozeUntil} onChange={(event) => setSnoozeUntil(event.target.value)} /></label></div><label>{visibility === "public" ? "Customer-visible response" : "Staff-only investigation note"}<textarea required minLength={2} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Record evidence and the next step; never paste secrets or identity documents." /></label><button className="button primary small" disabled={addMessage.isPending}>Add {visibility === "public" ? "public reply" : "internal note"}</button></form>
            <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); snooze.mutate({ token, ticketId: selected.ticket.id, until: new Date(snoozeUntil), note: snoozeNote }); }}><label>Snooze reason<input required minLength={3} value={snoozeNote} onChange={(event) => setSnoozeNote(event.target.value)} placeholder="Waiting for vendor evidence" /></label><button className="button secondary small" disabled={!snoozeUntil || snooze.isPending}><AlarmClock size={14} />Snooze until selected time</button></form>
          </> : <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); reopen.mutate({ token, ticketId: selected.ticket.id, reason: reopenReason }); }}><label>Reopen with new evidence<input required minLength={5} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="What changed after resolution?" /></label><button className="button secondary small" disabled={reopen.isPending}><RotateCcw size={14} />Reopen with fresh targets</button></form>}
          <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); link.mutate({ token, ticketId: selected.ticket.id, relatedTicketId: Number(relatedId), linkType }); }}><label>Link another case<input required type="number" min={1} value={relatedId} onChange={(event) => setRelatedId(event.target.value)} placeholder="Related case ID" /></label><label>Relationship<select value={linkType} onChange={(event) => setLinkType(event.target.value as typeof linkType)}><option value="related">Related</option><option value="duplicate">Duplicate</option><option value="blocks">Blocks</option></select></label><button className="button secondary small" disabled={link.isPending}><Link2 size={14} />Link without merging</button></form>
        </Panel>
        <Panel title="Collaboration and complete history"><div className="sales-timeline">{[...data.messages.filter((item) => item.ticketId === selected.ticket.id).map((item) => ({ id: `m-${item.id}`, at: item.createdAt, title: item.visibility === "public" ? "Public reply" : "Internal staff note", body: item.body })), ...data.events.filter((item) => item.ticketId === selected.ticket.id).map((item) => ({ id: `e-${item.id}`, at: item.createdAt, title: item.action.replaceAll("_", " "), body: item.note || "Case event recorded" }))].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).map((item) => <article key={item.id}><span>{shortDate(item.at)}</span><div><strong>{item.title}</strong><p>{item.body}</p></div></article>)}</div>{data.links.filter((item) => item.ticketId === selected.ticket.id || item.relatedTicketId === selected.ticket.id).map((item) => <p className="linked-case-note" key={item.id}>Case #{item.ticketId} <strong>{item.linkType}</strong> case #{item.relatedTicketId} · no destructive merge</p>)}</Panel>
      </> : <Panel title="Case detail"><EmptyState title="Select a case" detail="Its ownership, targets, collaboration and evidence will appear here." /></Panel>}</div>
    </div>
    {errors.map((error, index) => <p className="form-error" key={index}>{error!.message}</p>)}
  </>;
}
