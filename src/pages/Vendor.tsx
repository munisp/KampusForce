import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Clock3, Copy, FlaskConical, KeyRound, LifeBuoy, Package, Plus, Radio, Settings2, ShieldCheck, Wallet } from "lucide-react";
import { EmptyState, Metric, Panel, useSystemStatus, WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { GettingStarted } from "@/components/product/GettingStarted";
import { VendorDeals, VendorProducts, VendorRecordedSales, VendorWalletHistory } from "@/components/product/VendorSales";
import { money, shortDate, StateBadge } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { useLocation } from "react-router";

type View = "command" | "products" | "wallet" | "rules" | "support";
type EventType = "account_created" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "refund" | "sale";

export default function Vendor() {
  const { token } = useWorkspace();
  const system = useSystemStatus();
  const overview = trpc.vendor.overview.useQuery({ token });
  const onboarding = trpc.vendor.onboarding.useQuery({ token });
  // Re-read the checklist whenever the dashboard data changes (a product listed, funds added, an approval).
  useEffect(() => { if (overview.dataUpdatedAt) onboarding.refetch(); }, [overview.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("command");
  // Links to a field (the Getting started checklist) open the tab it's on, then move to it.
  const location = useLocation();
  const hashId = location.hash.slice(1);
  const hashTab: View | null = hashId.startsWith("product") ? "products" : hashId.startsWith("fund") ? "wallet" : null;
  const [seenLink, setSeenLink] = useState("");
  if (hashTab && seenLink !== location.key) {
    setSeenLink(location.key);
    setView(hashTab);
  }
  useEffect(() => {
    if (!hashTab) return;
    const id = hashId;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [hashTab, hashId, location.key]);
  const [amount, setAmount] = useState("100000");
  const [productRef, setProductRef] = useState("");
  const [type, setType] = useState<EventType>("funded");
  const [phone, setPhone] = useState("08011112222");
  const [eventAmount, setEventAmount] = useState("10000");
  const [ruleProductId, setRuleProductId] = useState(0);
  const [basis, setBasis] = useState<"flat" | "pct">("flat");
  const [flatNaira, setFlatNaira] = useState("1200");
  const [pct, setPct] = useState("7.5");
  const [trigger, setTrigger] = useState<"signup" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "sale">("sale");
  const [recurrence, setRecurrence] = useState(1);
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [confirmDays, setConfirmDays] = useState(30);
  const [clawbackDays, setClawbackDays] = useState(60);
  const [sampleNaira, setSampleNaira] = useState("5000");
  const [confirmation, setConfirmation] = useState("");
  const [slaHours, setSlaHours] = useState("24");
  const [selectedTicketId, setSelectedTicketId] = useState(0);
  const [macroId, setMacroId] = useState(0);
  const [resolution, setResolution] = useState("");
  const [macroTitle, setMacroTitle] = useState("");
  const [macroBody, setMacroBody] = useState("");
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const refresh = () => { utils.vendor.overview.invalidate(); utils.rep.catalog.invalidate(); utils.rep.dashboard.invalidate(); utils.rep.earnings.invalidate(); };
  const funding = trpc.vendor.startEscrowFunding.useMutation({ onSuccess: (data) => window.location.assign(data.checkoutUrl) });
  const confirmFunding = trpc.vendor.confirmEscrowFunding.useMutation({ onSuccess: refresh });
  const addProduct = trpc.vendor.addProduct.useMutation({ onSuccess: () => { setNewProduct({ name: "", description: "", price: "", link: "", category: "other", basis: "flat", commission: "", trigger: "sale", stock: "", refundDays: "14" }); refresh(); } });
  const [newProduct, setNewProduct] = useState({ name: "", description: "", price: "", link: "", category: "other" as "fintech" | "airtime_data" | "devices" | "edtech" | "micro_insurance" | "other", basis: "flat" as "flat" | "pct", commission: "", trigger: "sale" as "signup" | "kyc_complete" | "funded" | "first_transaction" | "renewal" | "sale", stock: "", refundDays: "14" });
  const newIsSale = newProduct.trigger === "sale";
  // Back from Paystack checkout: Paystack is asked whether it was paid, and the address loses the reference.
  const fundingChecked = useRef(false);
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("funding");
    if (!reference || fundingChecked.current) return;
    fundingChecked.current = true;
    window.history.replaceState(null, "", "/vendor");
    confirmFunding.mutate({ token, reference });
  }, [confirmFunding, token]);
  const simulate = trpc.vendor.simulateEvent.useMutation({ onSuccess: refresh });
  const rotateCredential = trpc.vendor.rotateWebhookCredential.useMutation({ onSuccess: () => { setRotateConfirm(false); refresh(); } });
  const dryRun = trpc.vendor.ruleDryRun.useMutation({ onSuccess: () => setConfirmation("") });
  const publish = trpc.vendor.publishRule.useMutation({ onSuccess: () => { dryRun.reset(); setConfirmation(""); refresh(); } });
  const updateSla = trpc.vendor.updateSupportSla.useMutation({ onSuccess: refresh });
  const saveMacro = trpc.vendor.saveResolutionMacro.useMutation({ onSuccess: () => { setMacroTitle(""); setMacroBody(""); refresh(); } });
  const escalate = trpc.vendor.escalateSupport.useMutation({ onSuccess: () => { refresh(); utils.vendor.supportTimeline.invalidate(); } });
  const resolve = trpc.vendor.resolveSupport.useMutation({ onSuccess: () => { setResolution(""); setMacroId(0); refresh(); utils.vendor.supportTimeline.invalidate(); } });
  const selectedTicket = useMemo(() => overview.data?.supportCases.find((row) => row.ticket.id === selectedTicketId) || overview.data?.supportCases[0], [overview.data, selectedTicketId]);
  const timeline = trpc.vendor.supportTimeline.useQuery({ token, ticketId: selectedTicket?.ticket.id || 0 }, { enabled: view === "support" && Boolean(selectedTicket?.ticket.id) });
  if (overview.isLoading) return <WorkspaceLayout title="Your dashboard" subtitle="Your wallet, products and sales."><Loading /></WorkspaceLayout>;
  if (overview.error) return <WorkspaceLayout title="Your dashboard" subtitle="Your wallet, products and sales."><ErrorState message={overview.error.message} retry={overview.refetch} /></WorkspaceLayout>;
  const data = overview.data!;
  const selectedRef = productRef || data.catalog[0]?.product.vendorRef || "";
  const selected = data.catalog.find((c) => c.product.vendorRef === selectedRef);
  const selectedRuleProductId = ruleProductId || data.catalog[0]?.product.id || 0;
  const wallet = data.wallet;
  const counts = data.funnel.reduce((acc, d) => { acc[d.state] = (acc[d.state] || 0) + 1; return acc; }, {} as Record<string, number>);
  const gross = data.funnel.reduce((sum, d) => sum + (["paid", "payable", "confirmed"].includes(d.state) ? d.vendorCommissionKobo : 0), 0);
  return <WorkspaceLayout title={data.vendor.companyName} subtitle="Your products, the sales reps make for you, and your commission wallet.">
    {onboarding.data && <GettingStarted steps={onboarding.data.steps} intro="Three steps before reps can start selling for you. Each one unlocks the next." />}
    {system.paymentsTest && <div className="sandbox-banner"><FlaskConical size={18} /><p><strong>Test mode.</strong> Payments use Paystack's test system, so no real money moves. You can also try out a sale on the Wallet tab.</p></div>}
    <div className="workspace-tabs" role="tablist" aria-label="Vendor workspace views"><button className={view === "command" ? "active" : ""} onClick={() => setView("command")}><CircleDollarSign size={16} />Overview</button><button className={view === "products" ? "active" : ""} onClick={() => setView("products")}><Package size={16} />Products <span>{data.catalog.length}</span></button><button className={view === "wallet" ? "active" : ""} onClick={() => setView("wallet")}><Wallet size={16} />Wallet</button><button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}><Settings2 size={16} />Commission terms</button><button className={view === "support" ? "active" : ""} onClick={() => setView("support")}><LifeBuoy size={16} />Support <span>{data.funnelMetrics.openSupport}</span></button></div>
    {view === "command" && <>
      <div className="metrics-grid"><Metric label="Wallet balance" value={money(wallet?.balanceKobo || 0)} note="Money set aside to pay reps" tone="teal" /><Metric label="Customers referred" value={data.funnelMetrics.attributed} note={`${data.funnelMetrics.activationRate}% activation rate`} /><Metric label="Commission confirmed" value={money(gross)} note={`${counts.pending || 0} deals awaiting confirmation`} tone="mustard" /><Metric label="Your rating" value={`${data.vendor.qualityScore}/100`} note={`${data.funnelMetrics.csatRatings} closed-case ratings`} /></div>
      <VendorRecordedSales />
      <Panel title="Your sales so far" action={<span className="result-count">From referral to payment</span>}>
        <div className="funnel-track"><div><span>01</span><strong>{data.funnelMetrics.attributed}</strong><small>Referred</small></div><div><span>02</span><strong>{data.funnelMetrics.activated}</strong><small>Sold</small></div><div><span>03</span><strong>{data.funnelMetrics.confirmed}</strong><small>Confirmed</small></div><div><span>04</span><strong>{data.funnelMetrics.paid}</strong><small>Paid</small></div></div>
      </Panel>
      <VendorDeals deals={data.funnel} products={data.catalog.map((row) => row.product)} />
    </>}
    {view === "products" && <>
      <VendorProducts catalog={data.catalog} onChanged={refresh} />
      <Panel title="Add a product" action={<span className="result-count">Reps can share it as soon as it is listed</span>}>{data.vendor.status !== "active" ? <p>You can list products once your business is approved.</p> : <form className="form-stack" onSubmit={(e) => { e.preventDefault(); const minor = Math.round(Number(newProduct.commission) * 100); addProduct.mutate({ token, name: newProduct.name, description: newProduct.description, category: newProduct.category, priceKobo: Math.round(Number(newProduct.price || 0) * 100), landingUrl: newProduct.link || undefined, basis: newProduct.basis, triggerEvent: newProduct.trigger, ...(newIsSale ? { stockQuantity: newProduct.stock === "" ? undefined : Number(newProduct.stock), refundDays: Number(newProduct.refundDays || 14) } : {}), ...(newProduct.basis === "flat" ? { flatAmountKobo: minor } : { pctBps: Math.round(Number(newProduct.commission) * 100) }) }); }}>
        <label>Product name<input id="product-name" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} required /></label>
        <label>What a rep should say about it<textarea id="product-description" value={newProduct.description} onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })} minLength={10} required /></label>
        <label>Category<select id="product-category" value={newProduct.category} onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value as typeof newProduct.category })}><option value="fintech">Fintech</option><option value="airtime_data">Airtime and data</option><option value="devices">Devices</option><option value="edtech">Edtech</option><option value="micro_insurance">Micro-insurance</option><option value="other">Other products</option></select></label>
        <label>{newIsSale ? "Price per unit (₦)" : "Price (₦)"}<input id="product-price" type="number" min={newIsSale ? 1 : 0} step="0.01" required={newIsSale} value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })} /></label>
        <label>Link customers go to {newIsSale && <span className="optional">optional</span>}<input id="product-link" type="url" placeholder="https://" value={newProduct.link} onChange={(e) => setNewProduct({ ...newProduct, link: e.target.value })} required={!newIsSale} /></label>
        <label>Commission paid as<select id="product-basis" value={newProduct.basis} onChange={(e) => setNewProduct({ ...newProduct, basis: e.target.value as "flat" | "pct" })}><option value="flat">{newIsSale ? "A flat amount per unit (₦)" : "A flat amount (₦)"}</option><option value="pct">{newIsSale ? "A percentage of the sale (%)" : "A percentage of the amount (%)"}</option></select></label>
        <label>{newProduct.basis === "flat" ? "Commission (₦)" : "Commission (%)"}<input id="product-commission" type="number" min="0.01" step="0.01" value={newProduct.commission} onChange={(e) => setNewProduct({ ...newProduct, commission: e.target.value })} required /></label>
        <label>Commission is earned when<select id="product-trigger" value={newProduct.trigger} onChange={(e) => setNewProduct({ ...newProduct, trigger: e.target.value as typeof newProduct.trigger })}><option value="sale">A customer buys it (a rep records each sale)</option><option value="signup">The customer signs up</option><option value="kyc_complete">The customer verifies their identity</option><option value="funded">The customer adds money to their account</option><option value="first_transaction">The customer makes a first transaction</option><option value="renewal">The customer renews</option></select></label>
        {newIsSale && <div className="form-row"><label>In stock<input id="product-stock" type="number" min="0" step="1" value={newProduct.stock} onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })} placeholder="Leave empty to not track" /><small className="field-hint">Goes down when a sale is approved. Reps can't record more than you have.</small></label><label>Refund period (days)<input id="product-refund-days" type="number" min="0" max="90" step="1" value={newProduct.refundDays} onChange={(e) => setNewProduct({ ...newProduct, refundDays: e.target.value })} /><small className="field-hint">How long you have to dispute an approved sale.</small></label></div>}
        <button className="button primary" disabled={addProduct.isPending}><Plus size={16} />List product</button>
        {addProduct.data && <p className="success-message"><CheckCircle2 size={16} />Listed. {addProduct.data.repCommissionKobo ? <>On {newIsSale ? "a one-unit sale" : "each activation"} the rep gets {money(addProduct.data.repCommissionKobo)} and KampusForce {money(addProduct.data.platformFeeKobo)}.</> : null} Add photos to it under Your products.</p>}{addProduct.error && <p className="form-error">{addProduct.error.message}</p>}
      </form>}</Panel>
      <details className="developer-details"><summary>For your developers: send sales from your own system</summary><Panel title="Sales sent from your system" action={<span className="result-count">Key version {data.vendor.webhookKeyVersion}</span>}>
        <div className="metrics-grid three"><Metric label="Being retried" value={data.ingestion.retryScheduled} note="Temporary errors" tone="mustard" /><Metric label="Fixed by retrying" value={data.ingestion.resolved} note="Went through" tone="teal" /><Metric label="Need checking" value={data.ingestion.deadLetter} note="Couldn't be processed" tone={data.ingestion.deadLetter ? "danger" : "default"} /></div>
        <p className="panel-footnote">Sale details are deleted after 30 days. Payment history is kept.</p>
        {rotateCredential.data ? <div className="dry-run-receipt"><p className="eyebrow">SECRET KEY · VERSION {rotateCredential.data.keyVersion}</p><h3>Copy this secret key now. It won't be shown again.</h3><p>The old key stops working at {rotateCredential.data.previousCredentialExpiresAt.toLocaleString()}.</p><div className="copy-field"><input readOnly value={rotateCredential.data.secret} aria-label="Your secret key" /><button aria-label="Copy secret key" onClick={() => navigator.clipboard.writeText(rotateCredential.data!.secret)}><Copy size={17} /></button></div><button className="button secondary" onClick={() => rotateCredential.reset()}>I've copied it</button></div> : rotateConfirm ? <div className="publish-warning"><KeyRound size={18} /><p>Create a new secret key? The old one stops working in 15 minutes, so update your system before then.</p><div className="modal-actions"><button className="button secondary" onClick={() => setRotateConfirm(false)}>Cancel</button><button className="button primary" disabled={rotateCredential.isPending} onClick={() => rotateCredential.mutate({ token })}>{rotateCredential.isPending ? "Creating…" : "Create new key"}</button></div></div> : <button className="button secondary" onClick={() => setRotateConfirm(true)}><KeyRound size={16} />Create a new secret key</button>}
        {rotateCredential.error && <p className="form-error">{rotateCredential.error.message}</p>}
      </Panel></details>
    </>}
    {view === "wallet" && <>
      <div className="vendor-grid">
        <Panel title="Commission wallet" className="escrow-panel"><div className="wallet-visual"><Wallet size={25} /><span>ADD FUNDS</span><strong>{money(wallet?.balanceKobo || 0)}</strong><small>Low-balance alert at {money(wallet?.lowBalanceThresholdKobo || 0)}</small></div><form className="inline-form" onSubmit={(e) => { e.preventDefault(); funding.mutate({ token, amountKobo: Math.round(Number(amount) * 100) }); }}><label>Amount (₦)<input id="fund-amount" type="number" min="100" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><button className="button secondary" disabled={funding.isPending || data.vendor.status !== "active"}><Plus size={16} />Pay with Paystack</button></form>{confirmFunding.isPending && <p className="success-message">Checking the payment with Paystack…</p>}{confirmFunding.data?.state === "paid" && <p className="success-message"><CheckCircle2 size={16} />Payment confirmed: {money(confirmFunding.data.amountKobo)} added to your wallet.</p>}{confirmFunding.data?.state === "pending" && <p className="form-error">Paystack hasn't confirmed this payment yet. If you paid, it will be added within a few minutes.</p>}{confirmFunding.data?.state === "failed" && <p className="form-error">This payment failed, and nothing was added to your wallet.</p>}{(funding.error || confirmFunding.error) && <p className="form-error">{(funding.error || confirmFunding.error)?.message}</p>}<p className="panel-footnote">Reps are paid from this wallet. If it's too low, their commission waits until you add funds.</p></Panel>
        {system.paymentsTest && <Panel title="Try a test sale" className="event-panel"><form className="form-stack" onSubmit={(e) => { e.preventDefault(); simulate.mutate({ token, productRef: selectedRef, type, customerPhone: phone, amountKobo: Math.round(Number(eventAmount) * 100) }); }}><div className="form-row"><label>Product<select value={selectedRef} onChange={(e) => { setProductRef(e.target.value); const rule = data.catalog.find((c) => c.product.vendorRef === e.target.value)?.rule; if (rule) setType(rule.triggerEvent === "signup" ? "account_created" : rule.triggerEvent); }}>{data.catalog.map(({ product }) => <option key={product.id} value={product.vendorRef}>{product.name}</option>)}</select></label><label>What happened<select value={type} onChange={(e) => setType(e.target.value as EventType)}><option value="account_created">Signed up</option><option value="kyc_complete">Verified their identity</option><option value="funded">Added money</option><option value="first_transaction">Made a first transaction</option><option value="renewal">Renewed</option><option value="refund">Refunded</option></select></label></div><div className="form-row"><label>Customer phone<input value={phone} onChange={(e) => setPhone(e.target.value)} required /></label><label>Amount (₦)<input type="number" min="1" value={eventAmount} onChange={(e) => setEventAmount(e.target.value)} /></label></div><p className="privacy-note"><ShieldCheck size={16} />Use the same phone number the rep entered, so the sale is credited to them.</p>{selected && <p className="rule-hint"><Radio size={15} />This product pays when: <strong>{selected.rule.triggerEvent.replaceAll("_", " ")}</strong>. Other events are ignored, except refunds.</p>}<button className="button primary" disabled={simulate.isPending || !selectedRef}>{simulate.isPending ? "Sending…" : "Send test sale"}<ArrowRight size={16} /></button></form>{simulate.data && <div className="event-receipt"><CheckCircle2 size={20} /><div><strong>{TEST_SALE_TITLE[simulate.data.status] || simulate.data.status}</strong><p>{"deal_id" in simulate.data && simulate.data.deal_id ? `Sale #${simulate.data.deal_id} recorded for the rep.` : simulate.data.reason === "No active attribution" ? "No rep has shared this product with this customer yet. The first rep who does in the next 24 hours gets this sale; until then nothing is paid." : simulate.data.reason || "This event doesn't pay commission on this product, so nothing was recorded."}</p></div></div>}{simulate.error && <p className="form-error">{simulate.error.message}</p>}</Panel>}
      </div>
      <VendorWalletHistory />
    </>}
    {view === "rules" && <>
      <div className="rule-studio">
        <Panel title="Set your terms" className="rule-builder">
          <form className="form-stack" onSubmit={(event) => { event.preventDefault(); dryRun.mutate({ token, productId: selectedRuleProductId, basis, flatAmountKobo: basis === "flat" ? Math.round(Number(flatNaira) * 100) : undefined, pctBps: basis === "pct" ? Math.round(Number(pct) * 100) : undefined, triggerEvent: trigger, recurrenceMonths: recurrence, recurrenceIntervalMonths: recurrenceInterval, confirmDays, clawbackDays, sampleAmountKobo: basis === "pct" ? Math.round(Number(sampleNaira) * 100) : undefined }); }}>
            <label>Product<select value={selectedRuleProductId} onChange={(event) => { setRuleProductId(Number(event.target.value)); dryRun.reset(); }}>{data.catalog.map(({ product }) => <option key={product.id} value={product.id}>{product.name} · current v{data.catalog.find((row) => row.product.id === product.id)?.rule.version}</option>)}</select></label>
            <fieldset><legend>Commission type</legend><div className="segmented"><button type="button" className={basis === "flat" ? "active" : ""} onClick={() => { setBasis("flat"); dryRun.reset(); }}>Flat amount</button><button type="button" className={basis === "pct" ? "active" : ""} onClick={() => { setBasis("pct"); dryRun.reset(); }}>Percentage</button></div></fieldset>
            <div className="form-row">{basis === "flat" ? <label>Commission (₦)<input type="number" min="1" step="1" value={flatNaira} onChange={(event) => setFlatNaira(event.target.value)} required /></label> : <label>Commission rate (%)<input type="number" min="0.01" max="100" step="0.01" value={pct} onChange={(event) => setPct(event.target.value)} required /></label>}<label>Pay commission when the customer<select value={trigger} onChange={(event) => setTrigger(event.target.value as typeof trigger)}><option value="sale">Buys it (each recorded sale)</option><option value="signup">Signs up</option><option value="kyc_complete">Verified their identity</option><option value="funded">Added money</option><option value="first_transaction">Made a first transaction</option><option value="renewal">Renewed</option></select></label></div>
            {basis === "pct" && <label>Example sale amount (₦)<input type="number" min="1" value={sampleNaira} onChange={(event) => setSampleNaira(event.target.value)} /></label>}
            <div className="form-row"><label>How many renewals earn commission<input type="number" min="1" max="12" value={recurrence} onChange={(event) => setRecurrence(Number(event.target.value))} /><small className="field-hint">The first renewal counts as number one.</small></label><label>Months between renewals<input type="number" min="1" max="12" value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(Number(event.target.value))} /><small className="field-hint">Commission is only paid when you confirm the renewal.</small></label></div>
            <div className="form-row"><label>Waiting period (days)<input type="number" min="0" max="90" value={confirmDays} onChange={(event) => setConfirmDays(Number(event.target.value))} /></label><label>Refund period (days)<input type="number" min="0" max="365" value={clawbackDays} onChange={(event) => setClawbackDays(Number(event.target.value))} /></label></div>
            <button className="button primary" disabled={dryRun.isPending || !selectedRuleProductId}>Preview <ArrowRight size={16} /></button>{dryRun.error && <p className="form-error">{dryRun.error.message}</p>}
          </form>
        </Panel>
        <Panel title="Check and publish" className="dry-run-panel">
          {dryRun.data ? <div className="dry-run-receipt"><p className="eyebrow">{dryRun.data.productName} · v{dryRun.data.nextVersion}</p><h3>{money(dryRun.data.vendorCommissionKobo)}</h3><p>Vendor-funded commission {dryRun.data.sampleAmountKobo ? `on a ${money(dryRun.data.sampleAmountKobo)} sample event` : "per qualifying activation"}.</p><div className="dry-run-split"><div><span>Rep gets 80%</span><strong>{money(dryRun.data.repCommissionKobo)}</strong></div><div><span>KampusForce gets 20%</span><strong>{money(dryRun.data.platformFeeKobo)}</strong></div></div><dl className="product-terms"><div><dt>Pays when</dt><dd>{dryRun.data.triggerEvent.replaceAll("_", " ")}</dd></div><div><dt>Waiting period</dt><dd>{dryRun.data.confirmDays} days</dd></div><div><dt>Refund period</dt><dd>{dryRun.data.clawbackDays} days</dd></div><div><dt>Renewals</dt><dd>{dryRun.data.recurrenceMonths} × every {dryRun.data.recurrenceIntervalMonths} month{dryRun.data.recurrenceIntervalMonths === 1 ? "" : "s"}</dd></div><div><dt>Preview ends</dt><dd>{shortDate(dryRun.data.expiresAt)}</dd></div></dl><div className="publish-warning"><AlertTriangle size={17} /><p>These terms apply to new sales only. Existing sales keep their old terms.</p></div><label>Type PUBLISH to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><button className="button primary" disabled={confirmation !== "PUBLISH" || publish.isPending} onClick={() => publish.mutate({ token, draftId: dryRun.data.draftId, confirmation: "PUBLISH" })}>Publish version {dryRun.data.nextVersion}</button>{publish.error && <p className="form-error">{publish.error.message}</p>}</div> : <EmptyState title="Nothing to check yet" detail="Set your terms and press Preview to see how each sale is split." />}
          {publish.data && <p className="success-message"><CheckCircle2 size={16} />Rule v{publish.data.version} published. Future events now use it.</p>}
        </Panel>
      </div>
      <Panel title="Past terms" action={<span className="result-count">Reps only see the latest terms</span>}><div className="table-wrap"><table><thead><tr><th>Product</th><th>Version</th><th>Terms</th><th>Pays when</th><th>Published</th><th>State</th></tr></thead><tbody>{data.ruleHistory.map(({ rule, productName }) => <tr key={rule.id}><td>{productName}</td><td className="mono">V{rule.version}</td><td><strong>{rule.basis === "flat" ? money(rule.flatAmountKobo || 0) : `${(rule.pctBps || 0) / 100}%`}</strong></td><td>{rule.triggerEvent.replaceAll("_", " ")}</td><td>{shortDate(rule.publishedAt)}</td><td><StateBadge state={rule.supersededAt ? "superseded" : "active"} /></td></tr>)}</tbody></table></div></Panel>
    </>}
    {view === "support" && <>
      <div className="metrics-grid"><Metric label="Open requests" value={data.funnelMetrics.openSupport} note="For your products" tone="mustard" /><Metric label="Overdue" value={data.funnelMetrics.breachedSupport} note={`${data.vendor.supportSlaHours}h vendor target`} tone={data.funnelMetrics.breachedSupport ? "danger" : "default"} /><Metric label="Your rating" value={`${data.vendor.qualityScore}/100`} note="Customer rating" tone="teal" /><Metric label="Saved replies" value={data.macros.length} note="Ready-made answers" /></div>
      <div className="support-config"><Panel title="Your reply time"><form className="inline-form" onSubmit={(event) => { event.preventDefault(); updateSla.mutate({ token, hours: Number(slaHours) }); }}><label>Reply within (hours)<input type="number" min="1" max="168" value={slaHours} onChange={(event) => setSlaHours(event.target.value)} /></label><button className="button secondary" disabled={updateSla.isPending}>Save</button></form><p className="panel-footnote">This applies to new requests only.</p>{updateSla.error && <p className="form-error">{updateSla.error.message}</p>}</Panel><Panel title="Add a saved reply"><form className="inline-form" onSubmit={(event) => { event.preventDefault(); saveMacro.mutate({ token, title: macroTitle, body: macroBody }); }}><label>Title<input value={macroTitle} onChange={(event) => setMacroTitle(event.target.value)} minLength={3} required /></label><label>Reply text<input value={macroBody} onChange={(event) => setMacroBody(event.target.value)} minLength={10} required /></label><button className="button secondary" disabled={saveMacro.isPending}>Save reply</button></form>{saveMacro.error && <p className="form-error">{saveMacro.error.message}</p>}</Panel></div>
      <div className="case-workspace vendor-cases"><Panel title="Support requests" className="case-inbox">{data.supportCases.length ? <div className="ticket-list">{data.supportCases.map((row) => <button key={row.ticket.id} className={selectedTicket?.ticket.id === row.ticket.id ? "selected" : ""} onClick={() => setSelectedTicketId(row.ticket.id)}><span className="ticket-ref">{row.ticket.ticketRef}</span><strong>{row.ticket.subject}</strong><small>{row.repCode} · due {shortDate(row.ticket.slaDueAt)}</small><span className="ticket-meta"><StateBadge state={row.ticket.state} />{row.slaBreached && <em><AlertTriangle size={12} />Overdue</em>}</span></button>)}</div> : <EmptyState title="No requests right now" detail="Requests from reps about your products will appear here." />}</Panel>
        <Panel title={selectedTicket ? selectedTicket.ticket.subject : "Request"} className="case-detail" action={selectedTicket ? <StateBadge state={selectedTicket.ticket.state} /> : null}>{selectedTicket ? <><div className="case-facts"><div><span>Request</span><strong>{selectedTicket.ticket.ticketRef}</strong></div><div><span>Rep</span><strong>{selectedTicket.repCode}</strong></div><div><span>Reply due</span><strong>{shortDate(selectedTicket.ticket.slaDueAt)}</strong></div><div><span>Priority</span><strong>{selectedTicket.ticket.priority}</strong></div></div><p className="case-description">{selectedTicket.ticket.description}</p>{selectedTicket.ticket.state === "vendor_queue" && <div className="resolution-form"><label>Saved reply <span className="optional">optional</span><select value={macroId} onChange={(event) => { const id = Number(event.target.value); setMacroId(id); const macro = data.macros.find((item) => item.id === id); if (macro) setResolution(macro.body); }}><option value={0}>Your reply</option>{data.macros.map((macro) => <option value={macro.id} key={macro.id}>{macro.title}</option>)}</select></label><label>Reply<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} minLength={10} placeholder="How you solved this, in words the customer can read" /></label><div className="case-actions"><button className="button secondary" disabled={escalate.isPending} onClick={() => escalate.mutate({ token, ticketId: selectedTicket.ticket.id })}>Send to Operations</button><button className="button primary" disabled={resolution.length < 10 || resolve.isPending} onClick={() => resolve.mutate({ token, ticketId: selectedTicket.ticket.id, resolution, macroId: macroId || undefined })}>Mark solved and ask for a rating <ArrowRight size={15} /></button></div>{(escalate.error || resolve.error) && <p className="form-error">{escalate.error?.message || resolve.error?.message}</p>}</div>}{selectedTicket.ticket.resolution && <div className="resolution-block"><CheckCircle2 size={19} /><div><strong>Reply</strong><p>{selectedTicket.ticket.resolution}</p></div></div>}<div className="timeline"><p className="eyebrow">WHAT HAPPENED</p>{timeline.isLoading ? <Loading /> : timeline.error ? <ErrorState message={timeline.error.message} retry={timeline.refetch} /> : timeline.data?.events.map((event) => <div className="timeline-event" key={event.id}><span><Clock3 size={14} /></span><div><strong>{event.action.replaceAll("_", " ")}</strong><small>{event.actorRole} · {shortDate(event.createdAt)}</small>{event.note && <p>{event.note}</p>}</div></div>)}</div></> : <EmptyState title="Choose a request" detail="Its details will appear here." />}</Panel></div>
    </>}
    <div className="vendor-principles"><div><CircleDollarSign size={20} /><p><strong>No extra cost to customers</strong>You pay the commission, not the customer.</p></div><div><ShieldCheck size={20} /><p><strong>Customers verify with you</strong>KampusForce doesn't collect your customers' ID details.</p></div></div>
  </WorkspaceLayout>;
}

const TEST_SALE_TITLE: Record<string, string> = {
  accepted: "Sale recorded",
  processed: "Sale recorded",
  quarantined: "Sale held",
  ignored: "Nothing to pay",
  duplicate: "Already received",
};
