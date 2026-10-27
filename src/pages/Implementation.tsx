import { ArrowLeft, ArrowRight, Check, CircleDashed, ShieldAlert, Target, TrendingUp, UsersRound } from "lucide-react";
import { Link } from "react-router";
import { Brand } from "@/components/product/Brand";

const areas = [
  { name: "Vendor Rule Studio", score: 92, detail: "Persisted dry runs, exact kobo splits, typed publication, expiry and immutable versions. Future deals use the new rule; historical deals keep theirs." },
  { name: "Vendor funnel & command", score: 86, detail: "Escrow, event simulation, attribution-to-paid funnel, support configuration and quality share the same vendor-scoped records." },
  { name: "Campus recruiting & team management", score: 74, detail: "Lead-owned invitations, existing-rep assignment, team performance and recruiting status work. Invite acceptance, notifications and revocation workflows remain." },
  { name: "Top-decile lead designation", score: 82, detail: "Campus-specific confirmed-commission ranking, deterministic ties and signed-contractor gates are enforced by Ops. Seed fixtures are not real performance evidence." },
  { name: "Campus Lead override accounting", score: 92, detail: "The 5% team-commission override accrues from platform margin, joins eligible payouts and reverses after refunds without reducing the activating rep’s 80% share." },
  { name: "Support inbox & escalation", score: 88, detail: "Owned-deal/attribution case creation, rep → lead → vendor → Ops paths, scoped timelines and resolution controls are implemented and acceptance-tested." },
  { name: "SLA, macros & CSAT quality", score: 86, detail: "Vendor-specific due dates, breach records, approved macros, one-time CSAT and quality-score feedback work. Durable breach scheduling and notifications remain." },
  { name: "Attribution & assisted onboarding", score: 88, detail: "Signed links, QR, first-touch preservation, salted phone hashes and consent-led vendor-handoff telemetry remain active across Phase 2." },
  { name: "Event ingestion & historical rules", score: 90, detail: "HMAC validation, dedupe, quarantine and trigger mapping now select only active rules while deals retain their original commissionRuleId and amounts." },
  { name: "Escrow, payout & clawbacks", score: 86, detail: "Pre-funded escrow, direct and override entitlements, minimums, withholding, negative-balance netting and paid reversals passed the live database journey." },
  { name: "Security, privacy & RBAC", score: 70, detail: "Role/ownership scopes, token hashes, payload redaction and ticket phone hashes are present. Production throttling, secrets, append-only controls and compliance evidence remain." },
  { name: "Offline & installable shell", score: 70, detail: "Manifest, icons, versioned app-shell cache and last-viewed catalog remain. Financial and support mutations are deliberately not queued offline." },
  { name: "Fifteen-campus rollout & KPI telemetry", score: 32, detail: "The schema and rankings are campus-scoped, but only seeded campus workflows exist. Fifteen-campus operations and roadmap KPI evidence are not yet implemented." },
  { name: "Automated verification", score: 90, detail: "Type checks, production build, 19 unit tests, a repeatable database acceptance journey and desktop/mobile browser checks cover the new critical paths." },
  { name: "Target architecture & scale services", score: 42, detail: "PostgreSQL 16 schema, transactions, migration and acceptance verification are implemented. Hono/tRPC remains instead of NestJS; durable queues and later distributed services are not claimed." },
  { name: "Live providers & production operations", score: 38, detail: "OTP, NIN status, escrow, events and transfers are explicit sandbox adapters. Live callbacks, 09:00 WAT workers, reconciliation and operating evidence remain gates." },
];
const overall = Math.round(areas.reduce((sum, area) => sum + area.score, 0) / areas.length);

export default function Implementation() {
  return <div className="score-page">
    <header className="score-nav"><Brand /><Link to="/" className="text-link"><ArrowLeft size={15} />Workspace selector</Link></header>
    <main>
      <section className="score-hero"><div><p className="eyebrow">Phase 2 · evidence-based assessment</p><h1>Implementation,<br /><em>without the fog.</em></h1><p>Sixteen areas cover the broadened campus-scale scope. Working workflows earn credit; sandbox adapters, seed performance and future architecture do not earn production credit.</p></div><div className="overall-score"><span>PHASE 2 ASSESSED SCOPE</span><strong>{overall}<small>/100</small></strong><p>Functional slice; production gates remain</p><div><span style={{ width: `${overall}%` }} /></div></div></section>
      <section className="thesis-grid">
        <article><Target size={23} /><p className="eyebrow">THE GOAL</p><h2>Make campus distribution accountable.</h2><p>Become the vendor-neutral attribution, commission, escrow and settlement layer between vendors, NIN-verified student reps and customers.</p></article>
        <article><UsersRound size={23} /><p className="eyebrow">THE PROBLEM</p><h2>Introductions disappear before payment.</h2><p>Reps lack credible attribution and predictable earnings; vendors lack a trusted campus channel; customers need assisted access without added fees.</p></article>
        <article><TrendingUp size={23} /><p className="eyebrow">THE OPPORTUNITY</p><h2>One rail across repeat verticals.</h2><p>The same verified-event infrastructure can serve fintech, data, devices, edtech and micro-insurance without inventory or customer float.</p></article>
      </section>
      <section className="economics-strip"><div><span>VENDOR COMMISSION</span><strong>100%</strong></div><ArrowRight size={19} /><div><span>REP SHARE</span><strong>80%</strong></div><div><span>PLATFORM TAKE</span><strong>20%</strong></div><div><span>LEAD OVERRIDE</span><strong>5% of team rep commission</strong></div><div><span>OVERRIDE FUNDING</span><strong>Platform margin</strong></div><div><span>ESCROW PRINCIPLE</span><strong>Never front vendor money</strong></div></section>
      <section className="scorecard-section"><div className="section-intro"><p className="eyebrow">Per-workstream scorecard</p><h2>Sixteen areas. Sixteen honest scores.</h2><p>The unweighted mean includes unfinished rollout and production work. The Phase 1 baseline remains preserved in the repository scorecard.</p></div><div className="score-list">{areas.map((area, index) => <article key={area.name}><span className="score-index">{String(index + 1).padStart(2, "0")}</span><div><h3>{area.name}</h3><p>{area.detail}</p></div><div className="area-meter"><span><i style={{ width: `${area.score}%` }} /></span><strong>{area.score}</strong></div></article>)}</div></section>
      <section className="review-notes"><div><ShieldAlert size={24} /><h2>Material review findings</h2></div><ul><li><Check size={16} /><span><strong>Regulatory perimeter:</strong> keep KampusForce as a distribution and software layer, not a cash/deposit agent. Live launch still needs counsel and provider due diligence.</span></li><li><Check size={16} /><span><strong>Financial model:</strong> annual cumulative EBITDA must use year-end cumulative cells, not the sum of cumulative monthly balances.</span></li><li><Check size={16} /><span><strong>Narrative reconciliation:</strong> monthly-phased workbook results and annual-average executive figures are different scenarios and must not be presented as one forecast.</span></li><li><CircleDashed size={16} /><span><strong>Scale evidence:</strong> 55% active recruits, 14.4 monthly activations, 97% paid within 48 hours, &lt;4% disputes and 136k activated customers remain planning gates—not achieved results.</span></li></ul></section>
      <section className="score-cta"><p className="eyebrow">SEE THE RECORDS MOVE</p><h2>Don’t score the slides.<br />Exercise the workflow.</h2><Link className="button primary" to="/">Open a sandbox workspace <ArrowRight size={16} /></Link></section>
    </main>
  </div>;
}
