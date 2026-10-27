# KampusForce document review and implementation research

Review date: 2026-10-27

## 1. What the platform is deciding to implement

KampusForce is not intended to be another campus retailer, payment terminal operator or inventory holder. It is the trusted distribution and reconciliation layer between three parties:

1. **Vendors** publish products and commercial rules, fund commission escrow and emit verified activation/refund events.
2. **NIN-verified student reps** introduce and assist customers through signed attribution tools and earn vendor-funded commissions.
3. **Customers** receive assisted access at the vendor’s listed price and complete regulated KYC only with the vendor.

The platform’s durable asset is the evidence chain: consent and first touch → vendor event → commission rule → pending/confirmed/payable/paid state → escrow and ledger posting → payout or reversal.

### Goal

Make distributed campus acquisition measurable and payable without forcing each vendor to build its own rep network, attribution system, commission ledger and payout operation.

### Problem

- Reps cannot reliably prove which customer they introduced or when money will arrive.
- Vendors cannot easily distinguish a signup from a revenue-quality activation across a fragmented campus channel.
- Customers need guidance, but additional intermediaries can create markup, privacy and trust risks.
- Manual transfers and spreadsheets cannot provide a defensible clawback, dispute or audit record at scale.

### Opportunity

A common integration and settlement rail can be reused across fintech, airtime/data, devices, edtech and micro-insurance. Recurring product lines can increase rep and platform lifetime value, while escrow and event verification reduce fake-activation economics. The opportunity remains conditional on vendor supply, activation quality, repeat behavior and regulatory perimeter—not merely rep recruitment.

## 2. Requirements reviewed and translated

The executive summary, business/technical specification and phased roadmap consistently support these launch invariants:

- 80% rep / 20% platform allocation of funded vendor commission.
- Commission only on the defined verified activation, not an empty registration.
- Vendor escrow before liability; no platform funding of vendor commissions.
- Pending → confirmed → payable → paid, with refund voids and paid-deal clawbacks.
- First-touch attribution, signed links/QR, assisted onboarding and privacy-preserving customer identifiers.
- Nigerian bank payout pre-flight checks, name matching, minimum batch and withholding calculation.
- Manual-first validation before vendor self-service and broader national expansion.
- No rep joining fee, customer markup, inventory, terminal or customer float.

The implementation deliberately prioritizes F1, F2, F3, F6 and F11, plus enough vendor/operations surface to exercise those records end to end. The later vendor self-service and national/polyglot scale phases remain roadmap work.

## 3. Infographic review

The deal-payback infographic is arithmetically consistent in its mix-weighted examples:

- ₦746 blended first rep payment and ₦1,692 blended 12-month rep value.
- ₦2,115 vendor-funded 12-month value, of which ₦423 is the 20% platform share.
- The 30-day confirmation, next-batch payout and 60-day post-confirmation clawback sequence matches the core state model.

Two cautions:

- “Rep: instant payout” should be read as the next eligible batch **after confirmation**, not instant payment at activation. Customer-facing copy should make this explicit.
- Vendor CAC comparisons, rep payback, top-decile concentration and steady-state earnings are planning assumptions pending pilot data. They are not validated market benchmarks or audited outcomes.

## 4. Financial workbook audit

The monthly assumption references are aligned. The material formula issue is in `Annual Summary` cumulative EBITDA:

- `=SUM('Monthly Model'!T4:T15)`
- `=SUM('Monthly Model'!T16:T27)`
- `=SUM('Monthly Model'!T28:T39)`

These formulas sum cumulative balances repeatedly. They should instead reference the year-end cumulative cells, conceptually `T15`, `T27` and `T39`.

Cached monthly-phased outputs inspected from the workbook:

| Metric | Year 1 | Year 2 | Year 3 |
|---|---:|---:|---:|
| Activations | 9,432 | 79,632 | 323,006 |
| Revenue | ₦13,489,737 | ₦83,684,340 | ₦236,631,534 |
| Operating expense | ₦46,398,975 | ₦131,684,218 | ₦253,831,577 |
| Annual EBITDA | −₦32,909,238 | −₦47,999,878 | −₦17,200,043 |

Break-even worksheet observations:

- First non-negative monthly EBITDA: month 33.
- Cumulative EBITDA does not become non-negative within 36 months.
- Funding trough: approximately −₦112,056,548.67.
- Revenue/activation: ₦423; variable cost/activation: ₦150; contribution/activation: ₦273.
- Year 1 fixed cost/month: ₦3,833,333.33; unit break-even: 14,042 activations/month.

### Reconciliation required before investor use

The monthly-phased model does not support narrative figures such as ₦12.9M/₦75.5M/₦196.3M revenue or a ₦45–50M funding trough. The executive summary’s annual-average case—₦29.1M/₦107.9M/₦323.0M revenue and positive Year 3 EBITDA—is a different scenario and must be labelled and reconciled, not blended with monthly-phased results.

Recommended correction package:

1. Fix annual cumulative EBITDA roll-ups and recalculate the workbook.
2. Publish one source-of-truth assumptions register and scenario definitions.
3. Reconcile revenue, opex, EBITDA, break-even and funding trough across deck, summary and workbook.
4. Separate pilot evidence from assumptions for CAC, conversion, recurrence and rep concentration.
5. Add escrow liability and cash-timing reconciliation, not only P&L projections.

## 5. Regulatory and provider research

### Nigeria Data Protection Act / GAID 2025

The NDPC’s General Application and Implementation Directive addresses registration of data controllers/processors of major importance where applicable, DPO/CAR obligations, data processing agreements, privacy notices and security controls. One designation trigger is processing more than 200 data subjects in six months; sector and risk tests also matter. KampusForce should determine its role per vendor flow, minimize identifiers, maintain processing records and formalize vendor/rep data agreements before scale.

Official source: [NDPC GAID 2025](https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf).

Breach-response guidance includes NDPC notification within 72 hours where the applicable risk threshold is met. The production incident runbook should preserve evidence, assess risk and define notification ownership rather than assuming every incident has the same obligation.

Reference: [DLA Piper Nigeria data protection overview](https://www.dlapiperdataprotection.com/index.html?t=law&c=NG).

### Agent-banking perimeter

CBN states that revised agent-banking guidelines were issued on 6 October 2025, with location and exclusivity provisions effective 1 April 2026. KampusForce should preserve its position as distribution/software infrastructure and avoid cash handling, deposits, customer float or representation as a banking agent unless separately authorized.

Official source: [CBN reforms and guidelines](https://www.cbn.gov.ng/AboutCBN/Reforms.html).

This is an implementation constraint, not a legal opinion. Nigerian counsel and each regulated vendor must approve the final perimeter and scripts.

### Payout integration shape

Paystack’s documented single-transfer sequence is create recipient → generate reference → initiate transfer → listen for status; NUBAN is the Nigerian recipient type. The current sandbox models records and references only. Production must implement recipient creation, asynchronous status reconciliation, idempotent retries and failure/held states.

Official source: [Paystack single transfers](https://paystack.com/docs/transfers/single-transfers/).

## 6. Market and competitor evidence quality

The supplied “2M students / 280+ institutions” sizing and several CAC/competitor comparisons were not supported by sufficiently strong primary evidence during this review. Treat them as planning claims until institution-level population sources, vendor acquisition benchmarks and pilot cohort data are attached.

A useful Phase 0 research scorecard should track:

- Verified vendor activation rate by product and campus.
- Attribution match/quarantine rate and time to claim resolution.
- Refund/clawback rate and fraudulent-event rejection.
- Rep activation, 30/90-day retention and earnings distribution—not averages alone.
- Vendor CAC against its own comparable channel, renewal rate and contribution after commission.
- Escrow days, payout aging, dispute SLA and support cost per activated customer.

## 7. Architecture assessment

The specification’s long-term service list is broader than the launch evidence requires. NestJS/PostgreSQL/Redis may be a valid target, but Kafka, Kubernetes, TigerBeetle, Temporal, Dapr, polyglot services and a lakehouse should be justified by measured scale and operating requirements.

This implementation proves the commercial spine in a modular Hono/tRPC/Drizzle/MySQL runtime and records the deviation in ADR 001. Production hardening should precede distributed-system expansion.

## 8. Artifact coverage and limitation

Reviewed directly: executive summary PDF, business/technical specification PDF, phased MVP roadmap PDF, three-year financial workbook and deal-payback infographic.

The 316-second deck narration MP3 could not be transcribed in the execution environment after the available transcription paths failed. This report therefore does **not** claim to have reviewed the narration’s audio-only content. The other artifacts provide the requirements implemented here.
