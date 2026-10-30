import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, Clipboard, Copy, ExternalLink, FileQuestion, Filter, Link2, QrCode, Search, Send, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { RepFraudCases } from "@/components/product/RepFraudCases";
import { money, productCategories, shortDate, StateBadge } from "@/lib/format";
import { readOfflineSnapshot, writeOfflineSnapshot } from "@/lib/offlineSnapshot";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

function RepFrame({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return <WorkspaceLayout title={title} subtitle={subtitle}>{children}</WorkspaceLayout>;
}

export function RepOverview() {
  const { token } = useWorkspace();
  const profile = trpc.rep.me.useQuery({ token });
  const dashboard = trpc.rep.dashboard.useQuery({ token });
  if (profile.isLoading || dashboard.isLoading) return <RepFrame title="Your day, in one view" subtitle="Attribution, activations and earnings from the same source of truth."><Loading /></RepFrame>;
  if (profile.error || dashboard.error) return <RepFrame title="Your day, in one view" subtitle="Rep workspace"><ErrorState message={profile.error?.message || dashboard.error?.message || "Load failed"} retry={() => { profile.refetch(); dashboard.refetch(); }} /></RepFrame>;
  const me = profile.data!;
  const data = dashboard.data!;
  return <RepFrame title={`Good to see you, ${me.user.name.split(" ")[0]}.`} subtitle={`${me.campus?.name || "Campus"} · ${me.rep.code}`}>
    <div className="trust-strip"><ShieldCheck size={18} /><span><strong>{me.user.kycState === "verified" ? "Identity verified" : "Verification pending"}</strong> · {me.rep.status === "active" ? "Eligible for attribution and payouts" : "Complete activation requirements before payout"}</span><span className="quality-score">Quality score {me.rep.qualityScore}/100</span>{me.rep.tier === "campus_lead" && <Link className="text-link" to="/rep/team">Team & overrides <ArrowRight size={14} /></Link>}</div>
    <div className="metrics-grid">
      <Metric label="Verified activations" value={data.metrics.activations} note="Vendor events attributed to you" />
      <Metric label="In confirmation" value={money(data.metrics.pendingKobo)} note="Pending + confirmed commissions" tone="mustard" />
      <Metric label="Ready to pay" value={money(data.metrics.payableKobo)} note="Before payout withholding" tone="teal" />
      <Metric label="Paid to bank" value={money(data.metrics.paidKobo)} note="Net sandbox transfers" />
    </div>
    <RepFraudCases />
    <div className="dashboard-grid">
      <Panel title="Recent activations" action={<Link className="text-link" to="/rep/earnings">Full ledger <ArrowRight size={14} /></Link>}>
        {data.recent.length ? <div className="deal-list">{data.recent.map(({ deal, productName, vendorName }) => <div className="deal-row" key={deal.id}><span className="deal-marker" /><div><strong>{productName}</strong><small>{vendorName} · {shortDate(deal.createdAt)}</small></div><StateBadge state={deal.state} /><strong className="money-cell">{money(deal.repCommissionKobo)}</strong></div>)}</div> : <EmptyState title="No activations yet" detail="Create an attribution link, then use the vendor sandbox to verify an activation." />}
      </Panel>
      <Panel title="Next best action" className="action-panel">
        <span className="action-number">01</span><h3>Make your first attributable introduction.</h3><p>Choose a product, generate a signed link or QR, and let the vendor’s activation event do the rest.</p>
        <Link className="button primary" to="/rep/share">Create a share kit <ArrowRight size={16} /></Link>
        <div className="action-rule"><span>Trigger</span><strong>Verified activation—not a signup</strong></div>
        <div className="action-rule"><span>Split</span><strong>80% rep / 20% platform</strong></div>
      </Panel>
    </div>
    <Panel title="Recent payouts">
      {data.payouts.length ? <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Created</th><th>Gross</th><th>Withholding</th><th>Net paid</th><th>Status</th></tr></thead><tbody>{data.payouts.map((p) => <tr key={p.id}><td className="mono">{p.providerRef}</td><td>{shortDate(p.createdAt)}</td><td>{money(p.amountGrossKobo)}</td><td>{money(p.withholdingKobo)}</td><td><strong>{money(p.amountNetKobo)}</strong></td><td><StateBadge state={p.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No payouts yet" detail="Payable deals enter the sandbox batch after KYC, account-name and minimum-balance checks." />}
    </Panel>
  </RepFrame>;
}

export function RepCatalog() {
  const { token } = useWorkspace();
  const query = trpc.rep.catalog.useQuery({ token });
  const [cached] = useState<NonNullable<typeof query.data>>(() => {
    try { return JSON.parse(localStorage.getItem("kf_offline_catalog") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    if (query.data) localStorage.setItem("kf_offline_catalog", JSON.stringify(query.data));
  }, [query.data]);
  const rows = useMemo(() => query.data || (query.error ? cached : []), [query.data, query.error, cached]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const products = useMemo(() => rows.filter(({ product }) => (category === "all" || product.category === category) && `${product.name} ${product.description}`.toLowerCase().includes(search.toLowerCase())), [rows, search, category]);
  const offline = Boolean(query.error && cached.length);
  return <RepFrame title="Know exactly what you can earn." subtitle="Live product terms and immutable commission-rule versions.">
    {offline && <div className="sandbox-banner"><ShieldCheck size={17} /><p><strong>Offline catalog.</strong> Showing the last product terms saved on this device. Sharing and attribution require a connection.</p></div>}
    <div className="catalog-tools"><label className="search-field"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or benefits" /></label><label className="select-field"><Filter size={16} /><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{Object.entries(productCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span className="result-count">{products.length} offers</span></div>
    {query.isLoading ? <Loading label="Loading product terms…" /> : query.error && !cached.length ? <ErrorState message={query.error.message} retry={query.refetch} /> : products.length ? <div className="product-grid">{products.map(({ product, rule, vendorName, vendorQualityScore }) => <article className="product-card" key={product.id}>
      <div className="product-card-top"><span className="category-tag">{productCategories[product.category]}</span><span className="rule-version">RULE V{rule.version}</span></div>
      <p className="vendor-name">{vendorName} · Quality {vendorQualityScore}/100</p><h2>{product.name}</h2><p>{product.description}</p>
      <div className="commission-display"><small>Your 80% share</small><strong>{rule.basis === "flat" ? money(Math.round((rule.flatAmountKobo || 0) * 0.8)) : `${((rule.pctBps || 0) / 100 * 0.8).toFixed(1)}%`}</strong><span>{rule.basis === "flat" ? `of ${money(rule.flatAmountKobo || 0)} funded commission` : `of eligible transaction value`}</span></div>
      <dl className="product-terms"><div><dt>Earns on</dt><dd>{rule.triggerEvent.replaceAll("_", " ")}</dd></div><div><dt>Confirmation</dt><dd>{rule.confirmDays} days</dd></div><div><dt>Clawback window</dt><dd>{rule.clawbackDays} days</dd></div><div><dt>Listed price</dt><dd>{product.priceKobo ? money(product.priceKobo) : "Vendor checkout"}</dd></div></dl>
      <div className="pitch"><Clipboard size={16} /><p>{product.pitchScript}</p></div>
      {offline ? <button className="button primary" disabled>Sharing requires a connection</button> : <Link className="button primary" to={`/rep/share?product=${product.id}`}>Share this offer <ArrowRight size={16} /></Link>}
    </article>)}</div> : <EmptyState title="No matching offers" detail="Clear your search or choose another category." />}
  </RepFrame>;
}

export function RepShare() {
  const { token } = useWorkspace();
  const [params] = useSearchParams();
  const catalog = trpc.rep.catalog.useQuery({ token });
  const [productId, setProductId] = useState(Number(params.get("product")) || 0);
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<"link" | "qr">("link");
  const [copied, setCopied] = useState(false);
  const share = trpc.rep.share.useMutation({ onSuccess: () => setCopied(false) });
  const selectedId = productId || catalog.data?.[0]?.product.id || 0;
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); };
  return <RepFrame title="Share once. Keep the evidence." subtitle="Signed links, QR codes and privacy-preserving first-touch attribution.">
    <div className="share-layout">
      <Panel title="Build your share kit" className="share-builder">
        <div className="form-stack"><label>Product<select value={selectedId} onChange={(e) => { setProductId(Number(e.target.value)); share.reset(); }}>{(catalog.data || []).map(({ product, vendorName }) => <option key={product.id} value={product.id}>{product.name} · {vendorName}</option>)}</select></label>
          <label>Customer phone <span className="optional">optional, for pre-attribution</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0800 000 0000" /></label>
          <fieldset><legend>Attribution source</legend><div className="segmented"><button type="button" className={source === "link" ? "active" : ""} onClick={() => setSource("link")}><Link2 size={16} />Link</button><button type="button" className={source === "qr" ? "active" : ""} onClick={() => setSource("qr")}><QrCode size={16} />QR code</button></div></fieldset>
          <p className="privacy-note"><ShieldCheck size={16} />If supplied, the phone is normalized and salted-hashed for attribution. KampusForce does not collect the customer’s NIN or BVN.</p>
          <button className="button primary" disabled={!selectedId || share.isPending} onClick={() => share.mutate({ token, productId: selectedId, customerPhone: phone || undefined, source })}>{share.isPending ? "Signing…" : "Generate signed kit"}<ArrowRight size={16} /></button>
          {share.error && <p className="form-error">{share.error.message}</p>}</div>
      </Panel>
      <section className="share-preview">
        {share.data ? <><div className="qr-frame"><img src={share.data.qr} alt="QR code for your signed attribution link" /><span>SCAN TO OPEN VENDOR OFFER</span></div><div className="share-result"><span className={share.data.attributed ? "attribution-success" : "attribution-note"}>{phone ? share.data.attributed ? <><CheckCircle2 size={16} />First touch recorded</> : "Existing first touch preserved" : "Signed vendor handoff will record first touch"}</span><label>Signed URL<div className="copy-field"><input readOnly value={share.data.url} /><button onClick={() => copy(share.data!.url)} aria-label="Copy signed URL">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div></label><div className="share-actions"><button className="button secondary" onClick={() => copy(share.data!.text)}><Copy size={16} />{copied ? "Copied" : "Copy message"}</button><a className="button primary" href={share.data.whatsappUrl} target="_blank" rel="noreferrer"><Send size={16} />WhatsApp</a><a className="icon-button" href={share.data.url} target="_blank" rel="noreferrer" aria-label="Test signed link"><ExternalLink size={17} /></a></div></div></> : <div className="preview-empty"><QrCode size={48} /><h2>Your signed kit appears here.</h2><p>The short link contains only rep and product references. The vendor handoff receives a signed attribution token; customer phones never appear in the URL. KYC stays inside the vendor’s regulated flow.</p></div>}
      </section>
    </div>
  </RepFrame>;
}

const assistSteps = [
  { title: "Confirm customer consent", detail: "Explain the offer, commission relationship and that the vendor—not KampusForce—performs regulated KYC." },
  { title: "Compare the product terms", detail: "Read the listed price, eligibility and activation condition. Do not add a customer markup." },
  { title: "Open the vendor journey", detail: "Use the signed product link. Never ask for a customer’s NIN, BVN, password or OTP." },
  { title: "Customer completes vendor KYC", detail: "The customer enters sensitive information only in the vendor’s own regulated experience." },
  { title: "Wait for the qualifying action", detail: "A signup alone does not earn commission. The defined activation event must occur." },
  { title: "Confirm the handoff", detail: "The vendor event will create or update the deal. Track its commission state in Earnings." },
];

export function RepAssist() {
  const { token } = useWorkspace();
  const catalog = trpc.rep.catalog.useQuery({ token });
  const [productId, setProductId] = useState(0);
  const [phone, setPhone] = useState("");
  const [sessionId, setSessionId] = useState(0);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const start = trpc.rep.assistedStart.useMutation({ onSuccess: (d) => { setSessionId(d.sessionId); setStep(1); } });
  const advance = trpc.rep.assistedAdvance.useMutation({ onSuccess: (d) => setStep(d.currentStep) });
  const selectedId = productId || catalog.data?.[0]?.product.id || 0;
  const current = assistSteps[Math.max(0, step - 1)];
  const next = () => { if (!sessionId) start.mutate({ token, productId: selectedId, customerPhone: phone }); else if (step < 6) advance.mutate({ token, sessionId, step: step + 1 }); };
  return <RepFrame title="Assist without holding sensitive data." subtitle="A six-step guided handoff into the vendor’s own onboarding flow.">
    <div className="assist-layout">
      <aside className="step-rail">{assistSteps.map((s, i) => <div className={`${step === i + 1 ? "current" : ""} ${step > i + 1 || step === 6 && i === 5 ? "done" : ""}`} key={s.title}><span>{step > i + 1 || step === 6 && i === 5 ? <Check size={15} /> : String(i + 1).padStart(2, "0")}</span><p>{s.title}</p></div>)}</aside>
      <Panel title={step ? `Step ${step} of 6` : "Start an assisted session"} className="assist-panel">
        {!step ? <div className="form-stack"><label>Product<select value={selectedId} onChange={(e) => setProductId(Number(e.target.value))}>{(catalog.data || []).map(({ product }) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Customer phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Used once for salted attribution hash" required /></label><label className="consent-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>I confirm the customer has consented to attribution and vendor handoff.</span></label><div className="safety-callout"><ShieldCheck size={20} /><p><strong>Stop at the vendor boundary.</strong> KampusForce records session telemetry only. Customer KYC stays with the vendor.</p></div></div> : <div className="step-content"><span className="step-kicker">{step === 6 ? "HANDOFF COMPLETE" : "CUSTOMER ASSISTANCE"}</span><h2>{current.title}</h2><p>{current.detail}</p>{step === 3 && <div className="safety-callout"><ShieldCheck size={20} /><p>Never request or record an OTP, NIN, BVN, card PIN or vendor password.</p></div>}{step === 6 && <Link className="text-link" to="/rep/earnings">Open earnings ledger <ArrowRight size={15} /></Link>}</div>}
        <div className="assist-controls">{step > 0 && step < 6 && <span className="mono">SESSION #{sessionId}</span>}{step < 6 && <button className="button primary" disabled={!selectedId || !phone || (!step && !consent) || start.isPending || advance.isPending} onClick={next}>{!step ? "Record consent & start" : step === 5 ? "Complete handoff" : "Mark step complete"}<ArrowRight size={16} /></button>}{step === 6 && <button className="button secondary" onClick={() => { setStep(0); setSessionId(0); setPhone(""); setConsent(false); }}>Start another session</button>}</div>
        {(start.error || advance.error) && <p className="form-error">{start.error?.message || advance.error?.message}</p>}
      </Panel>
    </div>
  </RepFrame>;
}

export function RepEarnings() {
  const { token, user } = useWorkspace();
  const query = trpc.rep.earnings.useQuery({ token });
  const utils = trpc.useUtils();
  const [cached] = useState(() => readOfflineSnapshot<NonNullable<typeof query.data>>("earnings", user.id));
  useEffect(() => {
    if (query.data) writeOfflineSnapshot("earnings", user.id, query.data);
  }, [query.data, user.id]);
  const offline = Boolean(query.error && cached);
  const data = query.data || (offline ? cached?.data : undefined);
  const [disputeDeal, setDisputeDeal] = useState<number | null>(null);
  const [reason, setReason] = useState("activation_not_credited");
  const [evidence, setEvidence] = useState("");
  const dispute = trpc.rep.openDispute.useMutation({ onSuccess: () => { setDisputeDeal(null); setEvidence(""); utils.rep.earnings.invalidate(); utils.rep.dashboard.invalidate(); } });
  const deals = data?.deals || [];
  const totals = deals.reduce((acc, { deal }) => { acc[deal.state] = (acc[deal.state] || 0) + deal.repCommissionKobo; return acc; }, {} as Record<string, number>);
  return <RepFrame title="The commission ledger, line by line." subtitle="State changes, clawbacks, disputes and net payouts remain traceable.">
    {offline && cached && <div className="sandbox-banner"><ShieldCheck size={17} /><p><strong>Offline earnings snapshot.</strong> Read-only records saved {new Date(cached.savedAt).toLocaleString()} on this device. Disputes and all financial actions require a connection.</p></div>}
    <div className="metrics-grid three"><Metric label="Payable commission" value={money(totals.payable || 0)} note="Eligible for the next qualifying batch" tone="teal" /><Metric label="Paid commission" value={money(totals.paid || 0)} note="Gross value across paid deals" /><Metric label="Disputed" value={money(totals.disputed || 0)} note="Held pending an operations decision" tone="mustard" /></div>
    <Panel title="Activation ledger">
      {query.isLoading ? <Loading /> : query.error && !cached ? <ErrorState message={query.error.message} retry={query.refetch} /> : deals.length ? <div className="table-wrap"><table><thead><tr><th>Deal / product</th><th>Vendor</th><th>Created</th><th>Confirmation</th><th>State</th><th>Your commission</th><th></th></tr></thead><tbody>{deals.map(({ deal, productName, vendorName }) => <tr key={deal.id}><td><strong>#{deal.id} · {productName}</strong><small className="table-sub mono">{deal.eventId.slice(0, 13)}…</small></td><td>{vendorName}</td><td>{shortDate(deal.createdAt)}</td><td>{shortDate(deal.confirmAt)}</td><td><StateBadge state={deal.state} /></td><td><strong>{money(deal.repCommissionKobo)}</strong><small className="table-sub">Platform {money(deal.platformFeeKobo)}</small></td><td>{!offline && !["disputed", "void", "clawed_back"].includes(deal.state) && <button className="icon-button" title="Open dispute" onClick={() => setDisputeDeal(deal.id)}><FileQuestion size={17} /></button>}</td></tr>)}</tbody></table></div> : <EmptyState title="Your ledger is ready for its first deal" detail="Share an offer and ask the vendor sandbox to send a qualifying activation event." />}
    </Panel>
    <div className="dashboard-grid lower"><Panel title="Payout transfers"><div className="deal-list">{data?.payouts.length ? data.payouts.map((p) => <div className="deal-row" key={p.id}><WalletCards size={20} /><div><strong>{money(p.amountNetKobo)} net</strong><small>{p.provider} · {shortDate(p.paidAt || p.createdAt)}</small></div><StateBadge state={p.state} /></div>) : <EmptyState title="No transfers yet" detail="The minimum gross batch is ₦500. Sandbox withholding is calculated at 10%." />}</div></Panel><Panel title="Recent state history"><div className="history-list">{data?.history.length ? data.history.slice(0, 10).map((h) => <div key={h.id}><span className="history-dot" /><p><strong>{h.fromState || "created"} → {h.toState}</strong><small>{h.actor} · {shortDate(h.createdAt)}</small>{h.reason && <em>{h.reason}</em>}</p></div>) : <EmptyState title="No state changes yet" detail="Every transition will appear here with its actor and reason." />}</div></Panel></div>
    {disputeDeal && <div className="modal-backdrop" role="presentation" onClick={() => setDisputeDeal(null)}><form className="modal" onSubmit={(e) => { e.preventDefault(); dispute.mutate({ token, dealId: disputeDeal, reasonCode: reason, evidence }); }} onClick={(e) => e.stopPropagation()}><p className="eyebrow">DEAL #{disputeDeal}</p><h2>Open a commission dispute</h2><p>The deal will be held while operations reviews the evidence.</p><label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="activation_not_credited">Activation not credited</option><option value="commission_amount">Commission amount</option><option value="incorrect_refund">Incorrect refund</option><option value="payout_issue">Payout issue</option></select></label><label>Evidence note<textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Dates, vendor reference and what you expected" /></label>{dispute.error && <p className="form-error">{dispute.error.message}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDisputeDeal(null)}>Cancel</button><button className="button primary" disabled={dispute.isPending}>Submit dispute</button></div></form></div>}
  </RepFrame>;
}
