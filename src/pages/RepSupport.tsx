import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, LifeBuoy, MessageSquareText, Send, ShieldCheck, Star } from "lucide-react";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

export default function RepSupport() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const support = trpc.rep.support.useQuery({ token });
  const catalog = trpc.rep.catalog.useQuery({ token });
  const earnings = trpc.rep.earnings.useQuery({ token });
  const me = trpc.rep.me.useQuery({ token });
  const [selectedId, setSelectedId] = useState(0);
  const [dealId, setDealId] = useState(0);
  const [productId, setProductId] = useState(0);
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<"activation" | "commission" | "payout" | "vendor_product" | "refund" | "other">("activation");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [csat, setCsat] = useState(5);
  const [comment, setComment] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const selected = useMemo(() => support.data?.cases.find((row) => row.ticket.id === selectedId) || support.data?.cases[0], [support.data, selectedId]);
  const timeline = trpc.rep.supportTimeline.useQuery({ token, ticketId: selected?.ticket.id || 0 }, { enabled: Boolean(selected?.ticket.id) });
  const refresh = () => { utils.rep.support.invalidate(); utils.rep.supportTimeline.invalidate(); utils.rep.me.invalidate(); utils.rep.catalog.invalidate(); };
  const create = trpc.rep.createTicket.useMutation({ onSuccess: (ticket) => { setSelectedId(ticket.id); setShowCreate(false); setSubject(""); setDescription(""); setPhone(""); refresh(); } });
  const escalate = trpc.rep.escalateTicket.useMutation({ onSuccess: refresh });
  const rate = trpc.rep.rateTicket.useMutation({ onSuccess: () => { setComment(""); refresh(); } });
  if (support.isLoading || me.isLoading) return <WorkspaceLayout title="Customer support" subtitle="Help customers you referred."><Loading /></WorkspaceLayout>;
  if (support.error || me.error) return <WorkspaceLayout title="Support" subtitle="Your customers' requests"><ErrorState message={support.error?.message || me.error?.message || "Load failed"} retry={() => { support.refetch(); me.refetch(); }} /></WorkspaceLayout>;
  const cases = support.data!.cases;
  const open = cases.filter((row) => !["resolved", "closed"].includes(row.ticket.state)).length;
  const breached = cases.filter((row) => row.slaBreached).length;
  const rated = cases.filter((row) => row.ticket.csat);
  const average = rated.length ? (rated.reduce((sum, row) => sum + (row.ticket.csat || 0), 0) / rated.length).toFixed(1) : "—";
  const isOwn = selected?.repCode === me.data!.rep.code;
  return <WorkspaceLayout title="Customer support" subtitle="Only requests from customers you referred, plus your team's if you're a campus lead.">
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>Keep it private.</strong> Don't put a NIN, BVN, OTP, password or a customer's full details in your notes.</p></div>
    <div className="metrics-grid"><Metric label="Requests" value={cases.length} note={support.data!.isLead ? "Own + active campus team" : "Own referred customers only"} /><Metric label="Open" value={open} note="Still being worked on" tone="mustard" /><Metric label="Overdue" value={breached} note="Past their reply date" tone={breached ? "danger" : "default"} /><Metric label="Average rating" value={average} note="Out of 5" tone="teal" /></div>
    <div className="case-workspace">
      <Panel title="Requests" action={<button className="button primary small" onClick={() => setShowCreate(true)}><LifeBuoy size={15} />New request</button>} className="case-inbox">
        {cases.length ? <div className="ticket-list">{cases.map((row) => <button key={row.ticket.id} className={selected?.ticket.id === row.ticket.id ? "selected" : ""} onClick={() => setSelectedId(row.ticket.id)}>
          <span className="ticket-ref">{row.ticket.ticketRef}</span><strong>{row.ticket.subject}</strong><small>{row.vendorName} · {row.repCode}</small><span className="ticket-meta"><StateBadge state={row.ticket.state} />{row.slaBreached && <em><AlertTriangle size={12} />Overdue</em>}</span>
        </button>)}</div> : <EmptyState title="No requests yet" detail="When a customer you referred needs help, start a request here." />}
      </Panel>
      <Panel title={selected ? selected.ticket.subject : "Case detail"} className="case-detail" action={selected ? <StateBadge state={selected.ticket.state} /> : null}>
        {selected ? <>
          <div className="case-facts"><div><span>Request</span><strong>{selected.ticket.ticketRef}</strong></div><div><span>Vendor</span><strong>{selected.vendorName}</strong></div><div><span>Reply due</span><strong>{shortDate(selected.ticket.slaDueAt)}</strong></div><div><span>Deal</span><strong>{selected.ticket.dealId ? `#${selected.ticket.dealId}` : "No sale yet"}</strong></div></div>
          <p className="case-description">{selected.ticket.description}</p>
          {selected.ticket.resolution && <div className="resolution-block"><CheckCircle2 size={19} /><div><strong>Resolution</strong><p>{selected.ticket.resolution}</p></div></div>}
          <div className="case-actions">
            {selected.ticket.state === "rep_triage" && isOwn && <><button className="button secondary" onClick={() => escalate.mutate({ token, ticketId: selected.ticket.id, target: "campus_lead" })} disabled={escalate.isPending}>Ask my campus lead</button><button className="button primary" onClick={() => escalate.mutate({ token, ticketId: selected.ticket.id, target: "vendor" })} disabled={escalate.isPending}>Send to the vendor <ArrowRight size={15} /></button></>}
            {["rep_triage", "campus_lead_queue"].includes(selected.ticket.state) && !isOwn && support.data!.isLead && <button className="button primary" onClick={() => escalate.mutate({ token, ticketId: selected.ticket.id, target: "vendor" })} disabled={escalate.isPending}>Send to the vendor <ArrowRight size={15} /></button>}
          </div>
          {escalate.error && <p className="form-error">{escalate.error.message}</p>}
          {selected.ticket.state === "resolved" && isOwn && <form className="csat-form" onSubmit={(event) => { event.preventDefault(); rate.mutate({ token, ticketId: selected.ticket.id, csat, comment: comment || undefined }); }}><div><p className="eyebrow">HOW DID IT GO?</p><h3>Rate how this was solved.</h3><p>Your rating counts towards the rep's and vendor's scores.</p></div><div className="star-rating" aria-label="Rating">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={value <= csat ? "active" : ""} onClick={() => setCsat(value)} aria-label={`${value} out of 5`}><Star size={22} fill={value <= csat ? "currentColor" : "none"} /></button>)}</div><label>Comment <span className="optional">optional</span><input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} /></label><button className="button primary" disabled={rate.isPending}>Submit {csat}/5 & close</button>{rate.error && <p className="form-error">{rate.error.message}</p>}</form>}
          <div className="timeline"><p className="eyebrow">WHAT HAPPENED</p>{timeline.isLoading ? <Loading label="Loading…" /> : timeline.error ? <ErrorState message={timeline.error.message} retry={timeline.refetch} /> : timeline.data?.events.length ? timeline.data.events.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{event.actorRole} · {shortDate(event.createdAt)}</small>{event.note && <p>{event.note}</p>}</div></div>) : <EmptyState title="Nothing yet" detail="Updates will appear here." />}</div>
        </> : <EmptyState title="Choose a request" detail="Its details will appear here." />}
      </Panel>
    </div>
    {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}><form className="modal wide-modal" onSubmit={(event) => { event.preventDefault(); create.mutate({ token, dealId: dealId || undefined, productId: dealId ? undefined : productId || catalog.data?.[0]?.product.id, customerPhone: dealId ? undefined : phone, category, subject, description, priority }); }} onClick={(event) => event.stopPropagation()}><p className="eyebrow">NEW CUSTOMER REQUEST</p><h2>What does the customer need?</h2><p>Pick the sale, or enter the product and customer's phone number.</p><label>Sale <span className="optional">optional</span><select value={dealId} onChange={(event) => setDealId(Number(event.target.value))}><option value={0}>No sale yet, use the phone number</option>{(earnings.data?.deals || []).map(({ deal, productName }) => <option key={deal.id} value={deal.id}>#{deal.id} · {productName}</option>)}</select></label>{!dealId && <div className="form-row"><label>Product<select value={productId} onChange={(event) => setProductId(Number(event.target.value))}>{(catalog.data || []).map(({ product }) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label><label>Customer's phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="We scramble this before saving it" required /></label></div>}<div className="form-row"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="activation">Activation</option><option value="commission">Commission</option><option value="payout">Payout</option><option value="vendor_product">Product problem</option><option value="refund">Refund</option><option value="other">Other</option></select></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label></div><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={5} maxLength={180} required /></label><label>What happened?<textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={2000} placeholder="What happened and when? Leave out private details." required /></label>{create.error && <p className="form-error">{create.error.message}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="button primary" disabled={create.isPending || subject.length < 5 || description.length < 10}><Send size={15} />Send request</button></div></form></div>}
    <div className="support-principle"><MessageSquareText size={19} /><p><strong>How it works:</strong> you look first, then the vendor solves it, then the customer's experience is rated. Campus leads can help with their team's requests, and vendors can pass a request to Operations.</p></div>
  </WorkspaceLayout>;
}
