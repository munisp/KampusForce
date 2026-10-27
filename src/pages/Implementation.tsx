import { ArrowLeft, ArrowRight, Check, CircleDashed, ShieldAlert, Target, TrendingUp, UsersRound } from "lucide-react";
import { Link } from "react-router";
import { Brand } from "@/components/product/Brand";

const areas = [
  { name: "Rep identity & onboarding", score: 62, detail: "OTP sessions and rep profiles work; NIN verification is represented by seeded state, not a live provider." },
  { name: "Catalog & commission transparency", score: 90, detail: "Five seeded verticals, versioned rules, trigger terms, confirmation and clawback windows." },
  { name: "Share, QR & first-touch attribution", score: 88, detail: "Signed links, QR generation, WhatsApp handoff, salted phone hashes and first-touch preservation." },
  { name: "Assisted onboarding", score: 82, detail: "Six-step consent-led telemetry with an explicit vendor-KYC boundary; no sensitive KYC fields." },
  { name: "Vendor event ingestion", score: 86, detail: "Raw-body HMAC, timestamp checks, idempotency, quarantine and commission-trigger mapping." },
  { name: "Commission ledger & escrow", score: 82, detail: "Integer-kobo split, escrow reservation, payable posting, refunds and paid-deal clawbacks." },
  { name: "Bank payouts", score: 68, detail: "Pre-flight checks, minimums, netting, withholding and batches; transfer provider remains sandboxed." },
  { name: "Disputes & support evidence", score: 76, detail: "Rep case creation, operator decisions and state history; no messaging or SLA automation yet." },
  { name: "Vendor command", score: 84, detail: "Escrow, rules, funnel and event simulation share the same persisted records." },
  { name: "Ops, RBAC & audit", score: 82, detail: "Role-gated confirmation, payout and dispute controls with operator audit history." },
  { name: "Security & privacy controls", score: 64, detail: "Token hashes, OTP hashes and HMAC are present; production secrets, rate limits and compliance evidence remain." },
  { name: "Offline & installable shell", score: 70, detail: "Install manifest, service worker and cached catalog shell; offline mutations are intentionally not queued." },
  { name: "Automated verification", score: 78, detail: "Unit tests and an end-to-end API exercise cover the critical money and attribution paths." },
  { name: "Target architecture & scale services", score: 22, detail: "This is a modular Phase 1 runtime, not the later NestJS/PostgreSQL/Kubernetes/polyglot target." },
];
const overall = Math.round(areas.reduce((sum, area) => sum + area.score, 0) / areas.length);

export default function Implementation() {
  return <div className="score-page">
    <header className="score-nav"><Brand /><Link to="/" className="text-link"><ArrowLeft size={15} />Workspace selector</Link></header>
    <main>
      <section className="score-hero"><div><p className="eyebrow">Document-to-product review</p><h1>Implementation,<br /><em>without the fog.</em></h1><p>Scores measure what exists in this repository’s Phase 1 vertical slice. Sandbox adapters are not counted as live integrations; later-phase architecture is not counted as shipped.</p></div><div className="overall-score"><span>OVERALL SLICE</span><strong>{overall}<small>/100</small></strong><p>Core MVP foundation</p><div><span style={{ width: `${overall}%` }} /></div></div></section>
      <section className="thesis-grid">
        <article><Target size={23} /><p className="eyebrow">THE GOAL</p><h2>Make campus distribution accountable.</h2><p>Become the vendor-neutral attribution, commission, escrow and settlement layer between vendors, NIN-verified student reps and customers.</p></article>
        <article><UsersRound size={23} /><p className="eyebrow">THE PROBLEM</p><h2>Introductions disappear before payment.</h2><p>Reps lack credible attribution and predictable earnings; vendors lack a trusted campus channel; customers need assisted access without added fees.</p></article>
        <article><TrendingUp size={23} /><p className="eyebrow">THE OPPORTUNITY</p><h2>One rail across repeat verticals.</h2><p>The same verified-event infrastructure can serve fintech, data, devices, edtech and micro-insurance without inventory or customer float.</p></article>
      </section>
      <section className="economics-strip"><div><span>VENDOR COMMISSION</span><strong>100%</strong></div><ArrowRight size={19} /><div><span>REP SHARE</span><strong>80%</strong></div><div><span>PLATFORM TAKE</span><strong>20%</strong></div><div><span>EARNING TRIGGER</span><strong>Verified activation</strong></div><div><span>ESCROW PRINCIPLE</span><strong>Never front vendor money</strong></div></section>
      <section className="scorecard-section"><div className="section-intro"><p className="eyebrow">Per-workstream scorecard</p><h2>Fourteen areas. Fourteen honest scores.</h2><p>Each score reflects implemented behavior, integration depth and remaining production work—not presentation completeness.</p></div><div className="score-list">{areas.map((area, index) => <article key={area.name}><span className="score-index">{String(index + 1).padStart(2, "0")}</span><div><h3>{area.name}</h3><p>{area.detail}</p></div><div className="area-meter"><span><i style={{ width: `${area.score}%` }} /></span><strong>{area.score}</strong></div></article>)}</div></section>
      <section className="review-notes"><div><ShieldAlert size={24} /><h2>Material review findings</h2></div><ul><li><Check size={16} /><span><strong>Regulatory perimeter:</strong> keep KampusForce as a distribution and software layer, not a cash/deposit agent. Live launch still needs counsel and provider due diligence.</span></li><li><Check size={16} /><span><strong>Financial model:</strong> annual cumulative EBITDA must use year-end cumulative cells, not the sum of cumulative monthly balances.</span></li><li><Check size={16} /><span><strong>Narrative reconciliation:</strong> monthly-phased workbook results and annual-average executive figures are different scenarios and must not be presented as one forecast.</span></li><li><CircleDashed size={16} /><span><strong>Market claims:</strong> student population, institution count, CAC and competitor comparisons require primary-source validation before investor use.</span></li></ul></section>
      <section className="score-cta"><p className="eyebrow">SEE THE RECORDS MOVE</p><h2>Don’t score the slides.<br />Exercise the workflow.</h2><Link className="button primary" to="/">Open a sandbox workspace <ArrowRight size={16} /></Link></section>
    </main>
  </div>;
}
