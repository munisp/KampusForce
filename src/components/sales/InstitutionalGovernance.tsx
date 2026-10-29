import { BadgeCheck, Building2, Landmark, Send, ShieldCheck } from "lucide-react";
import { StateBadge } from "@/lib/format";
import { formNumber, formValue, useActionSuccess } from "@/lib/innovationForm";
import type { RouterOutputs } from "@/lib/routerTypes";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { ActionError, ActionSuccess, FormActions, NoRecords, RecordGrid, RecordItem } from "./InnovationShared";

type TalentData = RouterOutputs["talent"]["workspace"];
const institutionalTypes = new Set(["grant", "bursary", "public_service", "volunteer", "development_program", "public_health", "innovation_challenge", "emergency_response", "civic_program"]);

export function InstitutionalGovernance({ data, campaignId, onCampaignChange }: { data: TalentData; campaignId: number; onCampaignChange: (id: number) => void }) {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const success = useActionSuccess();
  const refresh = () => { utils.talent.workspace.invalidate(); success.show("Governance evidence saved. This creates no participant outcome, deal or commission."); };
  const options = { onSuccess: refresh } as const;
  const save = trpc.phase19.saveGovernance.useMutation(options);
  const addPartner = trpc.phase19.addPartner.useMutation(options);
  const reviewPartner = trpc.phase19.reviewPartner.useMutation(options);
  const submit = trpc.phase19.submitGovernance.useMutation(options);
  const review = trpc.phase19.reviewGovernance.useMutation(options);
  const campaigns = data.campaigns.filter((row) => institutionalTypes.has(row.campaign.campaignType));
  const selected = campaigns.find((row) => row.campaign.id === campaignId) || campaigns[0];
  const id = selected?.campaign.id || 0;
  const governance = data.institutionalGovernance.find((row) => row.campaignId === id);
  const partners = data.institutionalPartners.filter((row) => row.campaignId === id);
  const canManage = ["vendor", "ops", "admin"].includes(user.role) && selected && ["draft", "rejected"].includes(selected.campaign.state);
  const canReview = ["ops", "admin"].includes(user.role);
  const errors = [save.error, addPartner.error, reviewPartner.error, submit.error, review.error].filter(Boolean);
  if (!campaigns.length) return <NoRecords title="No institutional campaigns in scope" detail="Create a grant, bursary, public-service, volunteer, development, public-health, innovation, emergency-response or civic campaign first." />;
  return <div className="institutional-governance">
    <label className="innovation-context">Institutional programme<select value={id} onChange={(event) => onCampaignChange(Number(event.target.value))}>{campaigns.map((row) => <option key={row.campaign.id} value={row.campaign.id}>{row.campaign.title} · {row.campaign.state}</option>)}</select></label>
    <div className="sandbox-banner"><Landmark size={18} /><p><strong>Independent governance precedes campaign submission.</strong> Sponsor, funding, eligibility, safeguarding, accessibility and audit controls are programme evidence—not customer activation or financial entitlement.</p></div>
    {canManage && <>
      <form key={governance?.version || "new"} className="innovation-form" onSubmit={(event) => { event.preventDefault(); save.mutate({ token, campaignId: id, governance: {
        sponsorType: formValue(event, "sponsorType") as "government" | "international_organization" | "ngo" | "foundation" | "university" | "private",
        sponsorName: formValue(event, "sponsorName"), sponsorReference: formValue(event, "sponsorReference"),
        fundingModel: formValue(event, "fundingModel") as "grant" | "donor" | "procurement" | "mixed" | "self_funded",
        fundingReference: formValue(event, "fundingReference"), fundingCurrency: formValue(event, "fundingCurrency"),
        fundingAmountMinor: Math.round(Number(formValue(event, "fundingAmount") || 0) * 100), procurementReference: formValue(event, "procurementReference") || null,
        eligibilityPolicy: formValue(event, "eligibilityPolicy"), eligibleStudyLevels: formValue(event, "eligibleStudyLevels").split(",").map((value) => value.trim()).filter(Boolean),
        minimumGraduationYear: formValue(event, "minimumGraduationYear") ? formNumber(event, "minimumGraduationYear") : null,
        maximumGraduationYear: formValue(event, "maximumGraduationYear") ? formNumber(event, "maximumGraduationYear") : null,
        safeguardingPolicy: formValue(event, "safeguardingPolicy"), accessibilityPolicy: formValue(event, "accessibilityPolicy"), auditRequirements: formValue(event, "auditRequirements"),
      } }); }}>
        <h3>Sponsor, funding and procurement</h3>
        <div className="innovation-form-grid three">
          <label>Sponsor type<select name="sponsorType" defaultValue={governance?.sponsorType || "government"}><option value="government">Government</option><option value="international_organization">International organization</option><option value="ngo">NGO</option><option value="foundation">Foundation</option><option value="university">University</option><option value="private">Private</option></select></label>
          <label>Sponsor name<input required name="sponsorName" defaultValue={governance?.sponsorName || "Synthetic public programme sponsor"} /></label>
          <label>Sponsor reference<input required name="sponsorReference" defaultValue={governance?.sponsorReference || "SANDBOX-SPONSOR-001"} /></label>
          <label>Funding model<select name="fundingModel" defaultValue={governance?.fundingModel || "grant"}><option value="grant">Grant</option><option value="donor">Donor</option><option value="procurement">Procurement</option><option value="mixed">Mixed</option><option value="self_funded">Self-funded</option></select></label>
          <label>Funding reference<input required name="fundingReference" defaultValue={governance?.fundingReference || "SANDBOX-FUNDING-001"} /></label>
          <label>Currency<input required name="fundingCurrency" maxLength={3} defaultValue={governance?.fundingCurrency || "NGN"} /></label>
          <label>Funding amount <span className="optional">major units; sandbox reference only</span><input name="fundingAmount" type="number" min="0" step="0.01" defaultValue={governance?.fundingAmountMinor == null ? "0" : governance.fundingAmountMinor / 100} /></label>
          <label>Procurement reference <span className="optional">required for procurement</span><input name="procurementReference" defaultValue={governance?.procurementReference || "SANDBOX-PROCUREMENT-001"} /></label>
        </div>
        <h3>Enforceable participation controls</h3>
        <label>Eligibility policy<textarea required minLength={20} name="eligibilityPolicy" defaultValue={governance?.eligibilityPolicy || "Eligibility is assessed against the approved programme criteria with documented human review and an appeal path."} /></label>
        <div className="innovation-form-grid three"><label>Eligible study levels <span className="optional">comma separated; blank accepts all</span><input name="eligibleStudyLevels" defaultValue={governance?.eligibleStudyLevels.join(",") || "Undergraduate,Postgraduate"} /></label><label>Minimum graduation year<input name="minimumGraduationYear" type="number" min="2000" max="2100" defaultValue={governance?.minimumGraduationYear || ""} /></label><label>Maximum graduation year<input name="maximumGraduationYear" type="number" min="2000" max="2100" defaultValue={governance?.maximumGraduationYear || ""} /></label></div>
        <label>Safeguarding policy<textarea required minLength={20} name="safeguardingPolicy" defaultValue={governance?.safeguardingPolicy || "Named safeguarding contacts, escalation, incident handling and participant-protection duties apply throughout delivery."} /></label>
        <label>Accessibility policy<textarea required minLength={20} name="accessibilityPolicy" defaultValue={governance?.accessibilityPolicy || "Reasonable adjustments and accessible participation channels are reviewed without reducing programme standards."} /></label>
        <label>Audit requirements<textarea required minLength={20} name="auditRequirements" defaultValue={governance?.auditRequirements || "Partner approvals, eligibility decisions and independently observed outcomes remain available for programme audit."} /></label>
        <FormActions><button className="button primary small" disabled={save.isPending}><ShieldCheck size={14} />Save governance draft</button></FormActions>
      </form>
      <form className="innovation-form compact" onSubmit={(event) => { event.preventDefault(); addPartner.mutate({ token, campaignId: id, institutionName: formValue(event, "institutionName"), institutionType: formValue(event, "institutionType") as "government" | "international_organization" | "university" | "ngo" | "implementation_partner", countryCode: formValue(event, "countryCode"), partnerRole: formValue(event, "partnerRole") as "lead" | "partner" | "funder" | "safeguarding", governanceReference: formValue(event, "governanceReference") }); }}>
        <h3>Add an institution or delivery partner</h3><div className="innovation-form-grid three"><label>Institution<input required name="institutionName" defaultValue="Synthetic partner institution" /></label><label>Type<select name="institutionType"><option value="government">Government</option><option value="international_organization">International organization</option><option value="university">University</option><option value="ngo">NGO</option><option value="implementation_partner">Implementation partner</option></select></label><label>Country code<input required name="countryCode" minLength={2} maxLength={2} defaultValue="NG" /></label><label>Programme role<select name="partnerRole"><option value="lead">Lead</option><option value="partner">Partner</option><option value="funder">Funder</option><option value="safeguarding">Safeguarding</option></select></label><label>Governance reference<input required name="governanceReference" defaultValue="SANDBOX-PARTNER-001" /></label></div>
        <FormActions><button className="button secondary small" disabled={addPartner.isPending}><Building2 size={14} />Add for independent review</button></FormActions>
      </form>
    </>}
    {governance && <RecordItem title={`${governance.sponsorName} · ${governance.fundingModel.replaceAll("_", " ")}`} meta={`${governance.sponsorReference} · ${governance.fundingReference} · v${governance.version}`} status={<StateBadge state={governance.state} />}><p>{governance.eligibilityPolicy}</p><small>Study levels: {governance.eligibleStudyLevels.join(", ") || "all"} · graduation {governance.minimumGraduationYear || "any"}–{governance.maximumGraduationYear || "any"}</small><p><strong>Safeguarding:</strong> {governance.safeguardingPolicy}</p><p><strong>Accessibility:</strong> {governance.accessibilityPolicy}</p><small>{governance.auditRequirements}</small>{governance.reviewNote && <p>Review: {governance.reviewNote}</p>}<div className="innovation-record-actions">{canManage && ["draft", "rejected"].includes(governance.state) && <button className="button primary small" onClick={() => submit.mutate({ token, campaignId: id, expectedVersion: governance.version })} disabled={submit.isPending || !partners.length || partners.some((partner) => partner.state !== "approved")}><Send size={14} />Submit approved governance</button>}{canReview && governance.state === "pending_review" && <><button className="button primary small" onClick={() => review.mutate({ token, campaignId: id, decision: "approved", note: "Sponsor, funding, eligibility, safeguarding, accessibility and audit controls independently reviewed." })}><BadgeCheck size={14} />Approve governance</button><button className="button secondary small" onClick={() => review.mutate({ token, campaignId: id, decision: "rejected", note: "Governance evidence requires correction before campaign submission." })}>Reject governance</button></>}</div></RecordItem>}
    <RecordGrid>{partners.map((partner) => <RecordItem key={partner.id} title={partner.institutionName} meta={`${partner.institutionType.replaceAll("_", " ")} · ${partner.countryCode} · ${partner.partnerRole}`} status={<StateBadge state={partner.state} />}><small>{partner.governanceReference}</small>{partner.reviewNote && <p>{partner.reviewNote}</p>}{canReview && partner.state === "pending" && <div className="innovation-record-actions"><button className="button primary small" onClick={() => reviewPartner.mutate({ token, partnerId: partner.id, decision: "approved", note: "Institution identity, programme role and governance reference independently reviewed." })}>Approve partner</button><button className="button secondary small" onClick={() => reviewPartner.mutate({ token, partnerId: partner.id, decision: "rejected", note: "Partner evidence requires correction." })}>Reject</button></div>}</RecordItem>)}{!partners.length && <NoRecords detail="At least one independently approved institutional partner is required before governance submission." />}</RecordGrid>
    {success.message && <ActionSuccess>{success.message}</ActionSuccess>}{errors.map((error, index) => <ActionError key={index} error={error} />)}
  </div>;
}
