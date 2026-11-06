import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CheckCircle2, Clock3, Clipboard, Copy, ExternalLink, FileQuestion, Filter, Link2, Lock, QrCode, Search, Send, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, Metric, Panel, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { GettingStarted } from "@/components/product/GettingStarted";
import { fileToBase64, formatBytes, MAX_DOCUMENT_BYTES, shrinkPhoto } from "@/lib/files";
import { RepFraudCases } from "@/components/product/RepFraudCases";
import { useSystemStatus } from "@/components/product/WorkspaceLayout";
import { money, productCategories, shortDate, StateBadge } from "@/lib/format";
import { readOfflineSnapshot, writeOfflineSnapshot } from "@/lib/offlineSnapshot";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

function RepFrame({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return <WorkspaceLayout title={title} subtitle={subtitle}>{children}</WorkspaceLayout>;
}

export function RepOverview() {
  const system = useSystemStatus();
  const { token } = useWorkspace();
  const profile = trpc.rep.me.useQuery({ token });
  const dashboard = trpc.rep.dashboard.useQuery({ token });
  const onboarding = trpc.rep.onboarding.useQuery({ token });
  useEffect(() => { if (dashboard.dataUpdatedAt) onboarding.refetch(); }, [dashboard.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (profile.isLoading || dashboard.isLoading) return <RepFrame title="Your overview" subtitle="Your sales and earnings in one place."><Loading /></RepFrame>;
  if (profile.error || dashboard.error) return <RepFrame title="Your overview" subtitle="Campus rep"><ErrorState message={profile.error?.message || dashboard.error?.message || "Load failed"} retry={() => { profile.refetch(); dashboard.refetch(); }} /></RepFrame>;
  const me = profile.data!;
  const data = dashboard.data!;
  return <RepFrame title={`Good to see you, ${me.user.name.split(" ")[0]}.`} subtitle={`${me.campus?.name || "Campus"} · ${me.rep.code}`}>
    {onboarding.data && <GettingStarted steps={onboarding.data.steps} intro="Finish these and you can earn on your campus. Operations checks each document by eye." />}
    <div className="trust-strip"><ShieldCheck size={18} /><span><strong>{me.rep.status === "active" ? "You're active" : me.user.kycState === "verified" ? "ID approved" : "Not active yet"}</strong> · {me.rep.status === "active" ? "You can share products, earn and get paid" : onboarding.data?.steps.find((step) => step.key === "activation")?.state === "waiting" ? "Your checks are done. Operations activates you next" : "Finish the steps above so Operations can activate you"}</span><span className="quality-score">Quality score {me.rep.qualityScore}/100</span>{me.rep.tier === "campus_lead" && <Link className="text-link" to="/rep/team">Team & bonuses <ArrowRight size={14} /></Link>}</div>
    <div className="metrics-grid">
      <Metric label="Verified sales" value={data.metrics.activations} note="Sales vendors have confirmed for you" />
      <Metric label="Waiting period" value={money(data.metrics.pendingKobo)} note="Commission that isn't ready to pay yet" tone="mustard" />
      <Metric label="Ready to pay" value={money(data.metrics.payableKobo)} note="Before tax" tone="teal" />
      <Metric label="Paid out" value={money(data.metrics.paidKobo)} note={system.testMode ? "Test payouts: no real money sent" : "After tax"} />
    </div>
    <RepFraudCases />
    <div className="dashboard-grid">
      <Panel title="Recent sales" action={<Link className="text-link" to="/rep/earnings">All earnings <ArrowRight size={14} /></Link>}>
        {data.recent.length ? <div className="deal-list">{data.recent.map(({ deal, productName, vendorName }) => <div className="deal-row" key={deal.id}><span className="deal-marker" /><div><strong>{productName}</strong><small>{vendorName} · {shortDate(deal.createdAt)}</small></div><StateBadge state={deal.state} /><strong className="money-cell">{money(deal.repCommissionKobo)}</strong></div>)}</div> : <EmptyState title="No sales yet" detail="Share a product link. Your sale shows here once the vendor confirms it." />}
      </Panel>
      <Panel title="What to do next" className="action-panel">
        <span className="action-number">01</span><h3>Make your first sale.</h3><p>Pick a product and share your link. You earn when the vendor confirms the customer completed it.</p>
        <Link className="button primary" to="/rep/share">Get my link <ArrowRight size={16} /></Link>
        <Link className="text-link claim-link" to="/rep/record">Onboarded someone? Record the sale <ArrowRight size={14} /></Link>
        <div className="action-rule"><span>Trigger</span><strong>When the vendor confirms the sale, not at sign-up</strong></div>
        <div className="action-rule"><span>Split</span><strong>80% to you, 20% to KampusForce</strong></div>
      </Panel>
    </div>
    <Panel title="Recent payouts">
      {data.payouts.length ? <div className="table-wrap"><table><thead><tr><th>Ref</th><th>Created</th><th>Before tax</th><th>Tax held back</th><th>You received</th><th>Status</th></tr></thead><tbody>{data.payouts.map((p) => <tr key={p.id}><td className="mono">{p.providerRef}</td><td>{shortDate(p.createdAt)}</td><td>{money(p.amountGrossKobo)}</td><td>{money(p.withholdingKobo)}</td><td><strong>{money(p.amountNetKobo)}</strong></td><td><StateBadge state={p.state} /></td></tr>)}</tbody></table></div> : <EmptyState title="No payouts yet" detail="You're paid once your identity and bank name are verified and you've earned at least ₦500." />}
    </Panel>
  </RepFrame>;
}

/** Products this rep can't sell yet because a required lesson isn't passed. The server enforces it too. */
function useProductLocks() {
  const { token, user } = useWorkspace();
  const query = trpc.rep.productTraining.useQuery({ token }, { enabled: user.role === "rep" });
  return (productId: number) => [...new Set((query.data || []).filter((row) => row.productId === productId).map((row) => row.title))];
}

function ProductLock({ titles }: { titles: string[] }) {
  if (!titles.length) return null;
  return <p className="product-lock" role="status"><Lock size={15} /><span>Pass {titles.map((t) => `“${t}”`).join(", ")} in <Link to="/sales?view=training">Training</Link> to sell this product.</span></p>;
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
  const locks = useProductLocks();
  return <RepFrame title="Products you can sell" subtitle="What each product pays and when.">
    {offline && <div className="sandbox-banner"><ShieldCheck size={17} /><p><strong>You're offline.</strong> Showing the last products saved on this device. Connect to the internet to share them.</p></div>}
    <div className="catalog-tools"><label className="search-field"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" /></label><label className="select-field"><Filter size={16} /><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{Object.entries(productCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span className="result-count">{products.length} offers</span></div>
    {query.isLoading ? <Loading label="Loading products…" /> : query.error && !cached.length ? <ErrorState message={query.error.message} retry={query.refetch} /> : products.length ? <div className="product-grid">{products.map(({ product, rule, vendorName, vendorQualityScore }) => <article className="product-card" key={product.id}>
      <div className="product-card-top"><span className="category-tag">{productCategories[product.category]}</span><span className="rule-version">RULE V{rule.version}</span></div>
      <p className="vendor-name">{vendorName} · Quality {vendorQualityScore}/100</p><h2>{product.name}</h2><p>{product.description}</p>
      <div className="commission-display"><small>Your 80% share</small><strong>{rule.basis === "flat" ? money(Math.round((rule.flatAmountKobo || 0) * 0.8)) : `${((rule.pctBps || 0) / 100 * 0.8).toFixed(1)}%`}</strong><span>{rule.basis === "flat" ? `of ${money(rule.flatAmountKobo || 0)} funded commission` : `of eligible transaction value`}</span></div>
      <dl className="product-terms"><div><dt>You earn when</dt><dd>{rule.triggerEvent.replaceAll("_", " ")}</dd></div><div><dt>Waiting period</dt><dd>{rule.confirmDays} days</dd></div><div><dt>Refund period</dt><dd>{rule.clawbackDays} days</dd></div><div><dt>Listed price</dt><dd>{product.priceKobo ? money(product.priceKobo) : "Vendor checkout"}</dd></div></dl>
      <div className="pitch"><Clipboard size={16} /><p>{product.pitchScript}</p></div>
      {locks(product.id).length ? <ProductLock titles={locks(product.id)} /> : offline ? <button className="button primary" disabled>Connect to the internet to share</button> : <Link className="button primary" to={`/rep/share?product=${product.id}`}>Share this offer <ArrowRight size={16} /></Link>}
    </article>)}</div> : <EmptyState title="No matching offers" detail="Try another search or category." />}
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
  const locks = useProductLocks();
  const locked = locks(selectedId);
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); };
  return <RepFrame title="Share a product" subtitle="Send your link or QR code, and sales from it are credited to you.">
    <div className="share-layout">
      <Panel title="Create your link" className="share-builder">
        <div className="form-stack"><label>Product<select value={selectedId} onChange={(e) => { setProductId(Number(e.target.value)); share.reset(); }}>{(catalog.data || []).map(({ product, vendorName }) => <option key={product.id} value={product.id}>{product.name} · {vendorName}</option>)}</select></label>
          <label>Customer phone <span className="optional">optional</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0800 000 0000" /></label>
          <fieldset><legend>How you're sharing it</legend><div className="segmented"><button type="button" className={source === "link" ? "active" : ""} onClick={() => setSource("link")}><Link2 size={16} />Link</button><button type="button" className={source === "qr" ? "active" : ""} onClick={() => setSource("qr")}><QrCode size={16} />QR code</button></div></fieldset>
          <p className="privacy-note"><ShieldCheck size={16} />Adding a number helps link the customer to you. We scramble it before saving it, and we never ask for a NIN or BVN.</p>
          <ProductLock titles={locked} />
          <button className="button primary" disabled={!selectedId || share.isPending || locked.length > 0} onClick={() => share.mutate({ token, productId: selectedId, customerPhone: phone || undefined, source })}>{share.isPending ? "Signing…" : "Generate signed kit"}<ArrowRight size={16} /></button>
          {share.error && <p className="form-error">{share.error.message}</p>}</div>
      </Panel>
      <section className="share-preview">
        {share.data ? <><div className="qr-frame"><img src={share.data.qr} alt="QR code for your link" /><span>SCAN TO SEE THE OFFER</span></div><div className="share-result"><span className={share.data.attributed ? "attribution-success" : "attribution-note"}>{phone ? share.data.attributed ? <><CheckCircle2 size={16} />{share.data.pickedUpSales ? `Link ready. This customer had already bought: ${share.data.pickedUpSales === 1 ? "that sale is" : `${share.data.pickedUpSales} sales are`} now yours.` : "Link ready"}</> : "Another rep already has this customer, so a sale from them won't count for you." : "When the customer uses your link, the vendor records that they came from you."}</span><label>Your link<div className="copy-field"><input readOnly value={share.data.url} /><button onClick={() => copy(share.data!.url)} aria-label="Copy link">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div></label><div className="share-actions"><button className="button secondary" onClick={() => copy(share.data!.text)}><Copy size={16} />{copied ? "Copied" : "Copy message"}</button><a className="button primary" href={share.data.whatsappUrl} target="_blank" rel="noreferrer"><Send size={16} />WhatsApp</a><a className="icon-button" href={share.data.url} target="_blank" rel="noreferrer" aria-label="Open link"><ExternalLink size={17} /></a></div></div></> : <div className="preview-empty"><QrCode size={48} /><h2>Your link and QR code will appear here.</h2><p>Customers open the vendor's own app from this link, and that's where they sign up and verify their identity. Their phone number never appears in the link.</p></div>}
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
  const locks = useProductLocks();
  const current = assistSteps[Math.max(0, step - 1)];
  const next = () => { if (!sessionId) start.mutate({ token, productId: selectedId, customerPhone: phone }); else if (step < 6) advance.mutate({ token, sessionId, step: step + 1 }); };
  return <RepFrame title="Help a customer sign up" subtitle="Six steps to guide a customer to the vendor's app.">
    <div className="assist-layout">
      <aside className="step-rail">{assistSteps.map((s, i) => <div className={`${step === i + 1 ? "current" : ""} ${step > i + 1 || step === 6 && i === 5 ? "done" : ""}`} key={s.title}><span>{step > i + 1 || step === 6 && i === 5 ? <Check size={15} /> : String(i + 1).padStart(2, "0")}</span><p>{s.title}</p></div>)}</aside>
      <Panel title={step ? `Step ${step} of 6` : "Start an assisted session"} className="assist-panel">
        {!step ? <div className="form-stack"><label>Product<select value={selectedId} onChange={(e) => setProductId(Number(e.target.value))}>{(catalog.data || []).map(({ product }) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Customer phone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="We scramble this before saving it" required /></label><ProductLock titles={locks(selectedId)} /><label className="consent-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required /><span>The customer has agreed to be linked to me and sent to the vendor.</span></label><div className="safety-callout"><ShieldCheck size={20} /><p><strong>Stop when the customer reaches the vendor's app.</strong> The customer verifies their identity with the vendor, not with you or KampusForce.</p></div></div> : <div className="step-content"><span className="step-kicker">{step === 6 ? "HANDOFF COMPLETE" : "CUSTOMER ASSISTANCE"}</span><h2>{current.title}</h2><p>{current.detail}</p>{step === 3 && <div className="safety-callout"><ShieldCheck size={20} /><p>Never ask for or write down a customer's OTP, NIN, BVN, card PIN or password.</p></div>}{step === 6 && <Link className="text-link" to="/rep/earnings">See my earnings <ArrowRight size={15} /></Link>}</div>}
        <div className="assist-controls">{step > 0 && step < 6 && <span className="mono">SESSION #{sessionId}</span>}{step < 6 && <button className="button primary" disabled={!selectedId || !phone || (!step && !consent) || (!step && locks(selectedId).length > 0) || start.isPending || advance.isPending} onClick={next}>{!step ? "Record consent & start" : step === 5 ? "Complete handoff" : "Mark step complete"}<ArrowRight size={16} /></button>}{step === 6 && <button className="button secondary" onClick={() => { setStep(0); setSessionId(0); setPhone(""); setConsent(false); }}>Start another session</button>}</div>
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
  const [destinationAccount, setDestinationAccount] = useState("");
  const [destinationBank, setDestinationBank] = useState("");
  const banks = trpc.rep.banks.useQuery({ token }, { staleTime: 3_600_000, enabled: !offline });
  const lookup = trpc.rep.lookUpBankAccount.useMutation();
  const lookedUp = useRef("");
  useEffect(() => {
    const key = `${destinationBank}:${destinationAccount}`;
    if (!destinationBank || !/^\d{10}$/.test(destinationAccount) || lookedUp.current === key) return;
    lookedUp.current = key;
    lookup.mutate({ token, bankCode: destinationBank, accountNumber: destinationAccount });
  }, [destinationBank, destinationAccount]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookupCurrent = lookup.variables && lookup.variables.bankCode === destinationBank && lookup.variables.accountNumber === destinationAccount;
  const dispute = trpc.rep.openDispute.useMutation({ onSuccess: () => { setDisputeDeal(null); setEvidence(""); utils.rep.earnings.invalidate(); utils.rep.dashboard.invalidate(); } });
  const destination = trpc.rep.configurePayoutDestination.useMutation({ onSuccess: () => { setDestinationAccount(""); setDestinationBank(""); lookup.reset(); lookedUp.current = ""; utils.rep.earnings.invalidate(); } });
  const deals = data?.deals || [];
  const totals = deals.reduce((acc, { deal }) => { acc[deal.state] = (acc[deal.state] || 0) + deal.repCommissionKobo; return acc; }, {} as Record<string, number>);
  for (const correction of query.data?.corrections || []) if (correction.state !== "reversed") totals[correction.state === "paid" ? "paid" : "payable"] = (totals[correction.state === "paid" ? "paid" : "payable"] || 0) + correction.amountKobo;
  return <RepFrame title="Your earnings" subtitle="Every sale, payment and refund, with its status.">
    {offline && cached && <div className="sandbox-banner"><ShieldCheck size={17} /><p><strong>You're offline, so this may be out of date.</strong> Read-only records saved {new Date(cached.savedAt).toLocaleString()} on this device. Disputes and all financial actions require a connection.</p></div>}
    <div className="metrics-grid three"><Metric label="Ready to pay" value={money(totals.payable || 0)} note="Goes out in the next payout" tone="teal" /><Metric label="Paid" value={money(totals.paid || 0)} note="Before tax" /><Metric label="Disputed" value={money(totals.disputed || 0)} note="On hold while Operations looks into it" tone="mustard" /></div>
    <Panel title="Your bank account" action={<ShieldCheck size={18} />}>
      <p className="panel-note">Choose your bank and type your account number. We ask the bank whose account it is, and it must be in the name on your ID check. The account number is stored encrypted.</p>
      {data?.destination.configured && <BankAccountStatus destination={data.destination} />}
      {!offline && <form className="form-stack" onSubmit={(event) => { event.preventDefault(); destination.mutate({ token, accountNumber: destinationAccount, bankCode: destinationBank }); }}>
        <div className="form-row">
          <BankPicker banks={banks.data} loading={banks.isLoading} value={destinationBank} onChange={setDestinationBank} />
          <label>10-digit account number<input required inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} value={destinationAccount} onChange={(event) => setDestinationAccount(event.target.value.replace(/\D/g, ""))} autoComplete="off" /></label>
        </div>
        {banks.error && <p className="form-error" role="alert">{banks.error.message}</p>}
        <div aria-live="polite">
          {lookup.isPending && <p className="panel-note">Checking with your bank…</p>}
          {lookupCurrent && lookup.data && <p className={lookup.data.nameCheck === "no_match" ? "form-error" : "success-message"}><ShieldCheck size={16} />Account name: <strong>{lookup.data.accountName}</strong>{lookup.data.nameCheck === "review" ? " · close to the name on your ID check, so Operations will confirm it before payouts go there." : lookup.data.nameCheck === "no_match" ? " · this isn't the name on your ID check. Use an account in your own name." : ""}</p>}
          {lookupCurrent && lookup.error && <p className="form-error" role="alert">{lookup.error.message}</p>}
        </div>
        <button className="button secondary" disabled={destination.isPending || !lookupCurrent || !lookup.data || lookup.data.nameCheck === "no_match"}>{destination.isPending ? "Saving…" : data?.destination.configured ? "Use this account instead" : "Save this account"}</button>
        {destination.error && <p className="form-error" role="alert">{destination.error.message}</p>}
      </form>}
    </Panel>
    <RecordedSalesList onlyWaiting />
    <Panel title="Your sales" action={<Link className="text-link" to="/rep/record">Record a sale <ArrowRight size={14} /></Link>}>
      {query.isLoading ? <Loading /> : query.error && !cached ? <ErrorState message={query.error.message} retry={query.refetch} /> : deals.length ? <div className="table-wrap"><table><thead><tr><th>Sale / product</th><th>Vendor</th><th>Created</th><th>Waiting period</th><th>State</th><th>You earn</th><th></th></tr></thead><tbody>{deals.map(({ deal, productName, vendorName }) => <tr key={deal.id}><td><strong>#{deal.id} · {productName}</strong><small className="table-sub mono">{deal.eventId.slice(0, 13)}…</small></td><td>{vendorName}</td><td>{shortDate(deal.createdAt)}</td><td>{shortDate(deal.confirmAt)}</td><td><StateBadge state={deal.state} /></td><td><strong>{money(deal.repCommissionKobo)}</strong><small className="table-sub">Platform {money(deal.platformFeeKobo)}</small></td><td>{!offline && !["disputed", "void", "clawed_back"].includes(deal.state) && <button className="icon-button" title="Report a problem" onClick={() => setDisputeDeal(deal.id)}><FileQuestion size={17} /></button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No sales yet" detail="Share a product link. Your sales will show up here once vendors confirm them." />}
    </Panel>
    <div className="dashboard-grid lower"><Panel title="Payouts"><div className="deal-list">{data?.payouts.length ? data.payouts.map((p) => <div className="deal-row" key={p.id}><WalletCards size={20} /><div><strong>{money(p.amountNetKobo)} net</strong><small>{p.provider} · {shortDate(p.paidAt || p.createdAt)}</small></div><StateBadge state={p.state} /></div>) : <EmptyState title="No payouts yet" detail="The minimum payout is ₦500, and 10% is held back for tax." />}</div></Panel><Panel title="Recent updates"><div className="history-list">{data?.history.length ? data.history.slice(0, 10).map((h) => <div key={h.id}><span className="history-dot" /><p><strong>{h.fromState || "created"} → {h.toState}</strong><small>{h.actor} · {shortDate(h.createdAt)}</small>{h.reason && <em>{h.reason}</em>}</p></div>) : <EmptyState title="No updates yet" detail="Each change will appear here with who made it and why." />}</div></Panel></div>
    {disputeDeal && <div className="modal-backdrop" role="presentation" onClick={() => setDisputeDeal(null)}><form className="modal" onSubmit={(e) => { e.preventDefault(); dispute.mutate({ token, dealId: disputeDeal, reasonCode: reason, evidence }); }} onClick={(e) => e.stopPropagation()}><p className="eyebrow">DEAL #{disputeDeal}</p><h2>Report a problem with this commission</h2><p>We'll hold this sale while Operations looks into it.</p><label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="activation_not_credited">Sale not credited</option><option value="commission_amount">Wrong commission amount</option><option value="incorrect_refund">Wrong refund</option><option value="payout_issue">Payout issue</option></select></label><label>What happened?<textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Include dates, the vendor's reference and what you expected" /></label>{dispute.error && <p className="form-error">{dispute.error.message}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDisputeDeal(null)}>Cancel</button><button className="button primary" disabled={dispute.isPending}>Send report</button></div></form></div>}
  </RepFrame>;
}

// Shown first in the bank list: the banks and wallets most campus reps use.
const COMMON_BANKS = ["044", "058", "011", "033", "057", "035", "232", "999992", "999991", "50515", "50211", "214"];

function BankAccountStatus({ destination }: { destination: { bankName?: string | null; bankCode: string; accountName: string; accountLast4: string; nameCheck: string; reviewNote?: string | null } }) {
  const where = `${destination.accountName} · ${destination.bankName || destination.bankCode} · ending ${destination.accountLast4}`;
  if (destination.nameCheck === "matched" || destination.nameCheck === "approved") return <p className="success-message"><ShieldCheck size={16} />Payouts go to {where}. Confirmed with your bank.</p>;
  if (destination.nameCheck === "review") return <p className="panel-note"><strong>Waiting for Operations.</strong> {where}. The bank's name for this account is close to the name on your ID check, so a person confirms it before payouts go there.</p>;
  if (destination.nameCheck === "rejected") return <p className="form-error">Operations couldn't confirm {where} is yours{destination.reviewNote ? `: ${destination.reviewNote}` : "."} Add an account in your own name.</p>;
  return <p className="form-error">Your saved account ({where}) was added before we checked accounts with the bank. Add it again below so the bank can confirm it.</p>;
}

// Short names people actually type, mapped to Paystack's bank names.
const BANK_ALIASES: Record<string, string> = { "058": "gtb gtbank gtco", "033": "uba", "011": "firstbank first bank fbn", "214": "fcmb", "057": "zenith", "035": "wema alat", "232": "sterling", "070": "fidelity", "999992": "opay", "999991": "palmpay", "50515": "moniepoint", "50211": "kuda", "044": "access" };

function BankPicker({ banks, loading, value, onChange }: { banks?: { name: string; code: string }[]; loading: boolean; value: string; onChange: (code: string) => void }) {
  const selected = banks?.find((b) => b.code === value);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = !banks ? [] : words.length
    ? banks.filter((b) => { const hay = `${b.name} ${BANK_ALIASES[b.code] || ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(words[0])) - Number(!b.name.toLowerCase().startsWith(words[0])))
    : banks.filter((b) => COMMON_BANKS.includes(b.code));
  const shown = matches.slice(0, 8);
  const choose = (code: string) => { onChange(code); setText(""); setOpen(false); };
  if (selected) return <label>Bank<div className="bank-picked"><strong>{selected.name}</strong><button type="button" className="text-link" onClick={() => { onChange(""); setOpen(true); }}>Change</button></div></label>;
  return <div className="bank-picker">
    <label htmlFor="bank-search">Bank</label>
    <input id="bank-search" role="combobox" aria-expanded={open} aria-controls="bank-options" aria-autocomplete="list" autoComplete="off" required
      placeholder={loading ? "Loading banks…" : "Search for your bank, e.g. GTBank or OPay"} disabled={loading} value={text}
      onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      onChange={(event) => { setText(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
        else if (event.key === "Enter" && open && shown[active]) { event.preventDefault(); choose(shown[active].code); }
        else if (event.key === "Escape") setOpen(false);
      }} />
    {open && !loading && <ul id="bank-options" role="listbox" className="bank-options">
      {!words.length && <li className="bank-options-hint" aria-hidden="true">Common banks</li>}
      {shown.map((b, i) => <li key={b.code} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); choose(b.code); }}>{b.name}</li>)}
      {words.length > 0 && !shown.length && <li className="bank-options-hint">No bank matches “{text}”.</li>}
      {matches.length > shown.length && <li className="bank-options-hint">Keep typing to narrow {matches.length} banks.</li>}
    </ul>}
  </div>;
}

/** A rep records a sale they made, with proof. It shows as waiting for verification straight away. */
export function RepRecordSale() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const catalog = trpc.rep.catalog.useQuery({ token });
  const me = trpc.rep.me.useQuery({ token });
  const [productId, setProductId] = useState(0);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const record = trpc.rep.recordSale.useMutation({ onSuccess: () => { setPhone(""); setNote(""); setProof(null); setFileKey((k) => k + 1); utils.rep.recordedSales.invalidate(); utils.rep.earnings.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.onboarding.invalidate(); } });
  const active = me.data?.rep.status === "active";
  const locks = useProductLocks();
  const locked = productId ? locks(productId) : [];
  const result = record.data;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proof) return;
    if (proof.size > MAX_DOCUMENT_BYTES) { setStatus("That file is too big. The limit is 10 MB."); return; }
    setStatus("Preparing your proof…");
    const ready = await shrinkPhoto(proof);
    setStatus(`Sending ${formatBytes(ready.size)}…`);
    record.mutate({ token, productId, customerPhone: phone, note: note.trim() || undefined, proofBase64: await fileToBase64(ready) }, { onSettled: () => setStatus("") });
  };
  return <RepFrame title="Record a sale" subtitle="Onboarded someone? Record it here. It shows in your earnings straight away, waiting for verification.">
    <div className="share-layout">
      <Panel title="Who did you onboard?" className="share-builder">
        {!active && me.data && <div className="sandbox-banner"><ShieldCheck size={17} /><p><strong>You can record sales once you're active.</strong> Finish the steps on your Overview first.</p></div>}
        <form className="form-stack" onSubmit={submit}>
          <label>Product<select value={productId} onChange={(e) => { setProductId(Number(e.target.value)); record.reset(); }} disabled={!active} required><option value={0}>Choose the product</option>{(catalog.data || []).map(({ product, vendorName }) => <option key={product.id} value={product.id}>{product.name} · {vendorName}</option>)}</select></label>
          <label>Customer's phone number<input required inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); record.reset(); }} placeholder="0800 000 0000" disabled={!active} autoComplete="off" /><small>The number they used with the vendor.</small></label>
          <label>Proof<input key={fileKey} type="file" accept="image/jpeg,image/png,application/pdf" required disabled={!active} onChange={(e) => { setProof(e.target.files?.[0] || null); record.reset(); }} /><small>A screenshot or photo of the customer's confirmation, a receipt or a reference. JPG, PNG or PDF, up to 10 MB. Whoever verifies the sale sees it.</small></label>
          <label>Note <span className="optional">optional</span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Helped them sign up in the library on Tuesday" disabled={!active} /></label>
          <ProductLock titles={locked} />
          <button className="button primary" disabled={!active || record.isPending || locked.length > 0 || !productId || !proof || phone.trim().length < 7}>{record.isPending ? status || "Recording…" : "Record this sale"}<ArrowRight size={16} /></button>
          {status && !record.isPending && <p className="form-error">{status}</p>}
        </form>
        {record.error && <p className="form-error" role="alert">{record.error.message}</p>}
        {result && <div className={`claim-result ${result.state === "verified" ? "credited" : "waiting"}`} role="status">
          {result.state === "verified"
            ? <><CheckCircle2 size={20} /><div><strong>Recorded and already verified.</strong><p>The vendor had already reported this customer, so the sale is in your Earnings now.</p><Link className="text-link" to="/rep/earnings">See your earnings <ArrowRight size={14} /></Link></div></>
            : <><Clock3 size={20} /><div><strong>Recorded. Waiting for verification.</strong><p>{result.expectedRepCommissionKobo ? `You'll earn ${money(result.expectedRepCommissionKobo)} once it's verified. ` : ""}It's verified when the vendor reports this customer, or when Operations checks your proof. You'll get a notification.</p></div></>}
        </div>}
      </Panel>
      <Panel title="How it works">
        <div className="fraud-boundaries">
          <p><strong>1. You record it</strong><span>It shows in your earnings straight away as waiting for verification.</span></p>
          <p><strong>2. It's verified</strong><span>Automatically when the vendor reports this customer, or by Operations, who look at your proof.</span></p>
          <p><strong>3. You're paid</strong><span>After the vendor's waiting period, it's paid out with your other earnings.</span></p>
          <p><strong>Once per customer</strong><span>Each customer belongs to the first rep who links them. Honest records only: a false one can lead to a strike or suspension.</span></p>
        </div>
      </Panel>
    </div>
    <RecordedSalesList />
  </RepFrame>;
}

const RECORDED_STATE: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Waiting for verification", cls: "waiting" },
  verified: { label: "Verified", cls: "ok" },
  rejected: { label: "Not verified", cls: "no" },
};

export function RecordedSalesList({ onlyWaiting = false }: { onlyWaiting?: boolean }) {
  const { token } = useWorkspace();
  const list = trpc.rep.recordedSales.useQuery({ token });
  const rows = (list.data || []).filter((row) => !onlyWaiting || row.sale.state === "waiting");
  if (onlyWaiting && !rows.length) return null;
  return <Panel title={onlyWaiting ? "Waiting for verification" : "Sales you recorded"} action={<Link className="text-link" to="/rep/record">Record a sale <ArrowRight size={14} /></Link>}>
    {list.isLoading ? <Loading /> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Customer</th><th>Recorded</th><th>Status</th></tr></thead><tbody>{rows.map(({ sale, productName, vendorName }) => <tr key={sale.id}>
      <td><strong>{productName}</strong><small className="table-sub">{vendorName}</small></td>
      <td className="mono">•••• {sale.customerPhoneLast4}</td>
      <td>{shortDate(sale.createdAt)}</td>
      <td><span className={`new-rep-badge ${RECORDED_STATE[sale.state]?.cls || "waiting"}`}>{RECORDED_STATE[sale.state]?.label || sale.state}</span>{sale.state === "verified" && <small className="table-sub">{sale.verifiedBy === "vendor" ? "The vendor reported it" : "Checked by Operations"}</small>}{sale.state === "rejected" && sale.reviewReason && <small className="table-sub">{sale.reviewReason}</small>}</td>
    </tr>)}</tbody></table></div> : <EmptyState title="No recorded sales yet" detail="When you onboard someone, record it here so it's credited to you." />}
  </Panel>;
}
