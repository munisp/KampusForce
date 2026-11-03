import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { BarChart3, BookOpenCheck, BriefcaseBusiness, CalendarClock, Link2, Megaphone, PlugZap, ShieldCheck, Target, UserRoundSearch, Workflow } from "lucide-react";
import { WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { useWorkspace } from "@/providers/workspace";
import { CaseWorkspace } from "@/components/sales/CaseWorkspace";
import { PipelineWorkspace } from "@/components/sales/PipelineWorkspace";
import { TrainingWorkspace } from "@/components/sales/TrainingWorkspace";
import { CampaignWorkspace } from "@/components/sales/CampaignWorkspace";
import { GrowthWorkspace } from "@/components/sales/GrowthWorkspace";
import { IntegrationWorkspace } from "@/components/sales/IntegrationWorkspace";
import { PromotionWorkspace } from "@/components/sales/PromotionWorkspace";
import { PlatformInnovationWorkspace } from "@/components/sales/PlatformInnovationWorkspace";
import { TalentWorkspace } from "@/components/sales/TalentWorkspace";
import { ConnectorWorkspace } from "@/components/sales/ConnectorWorkspace";
import { RecurrenceWorkspace } from "@/components/sales/RecurrenceWorkspace";

const views = [
  { key: "cases", label: "Customer requests", icon: Workflow, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "pipeline", label: "My contacts", icon: BriefcaseBusiness, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "intelligence", label: "Insights", icon: ShieldCheck, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "training", label: "Training", icon: BookOpenCheck, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "promotions", label: "Promotions", icon: Megaphone, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "campaigns", label: "Campaigns", icon: Megaphone, roles: ["rep", "vendor", "ops", "admin"] },
  { key: "opportunities", label: "Opportunities", icon: UserRoundSearch, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "connectors", label: "Customer sign-up links", icon: Link2, roles: ["rep", "vendor", "ops", "admin"] },
  { key: "recurrence", label: "Renewals", icon: CalendarClock, roles: ["vendor", "ops", "finance", "admin"] },
  { key: "growth", label: "Growth", icon: Target, roles: ["rep", "ops", "finance", "admin"] },
  { key: "integrations", label: "Connected services", icon: PlugZap, roles: ["vendor", "ops", "admin"] },
] as const;

type ViewKey = typeof views[number]["key"];

const copy: Record<ViewKey, { title: string; subtitle: string }> = {
  intelligence: { title: "Insights", subtitle: "Reports on how sales and support are going." },
  cases: { title: "Customer requests", subtitle: "See who owns each request and when a reply is due." },
  pipeline: { title: "My contacts", subtitle: "Keep track of the people you're talking to and when to follow up." },
  training: { title: "Training", subtitle: "Short lessons on selling honestly, privacy and helping customers." },
  promotions: { title: "Promotions", subtitle: "Vendor offers you can promote on campus, and how they're doing." },
  campaigns: { title: "Campaigns", subtitle: "Choose who to reach, get approval, and see the results." },
  opportunities: { title: "Opportunities", subtitle: "Campus jobs, grants and programmes, from application to result." },
  connectors: { title: "Customer sign-up links", subtitle: "Send customers to a vendor\'s sign-up, and follow their progress." },
  recurrence: { title: "Renewals", subtitle: "Commission on a renewal is paid only once the vendor confirms it." },
  growth: { title: "Growth", subtitle: "Leaderboards, product targets and inviting students to join." },
  integrations: { title: "Connected services", subtitle: "Set up and test the services linked to your business." },
};

export default function Sales() {
  const { user } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const allowed = useMemo(() => views.filter((view) => (view.roles as readonly string[]).includes(user.role)), [user.role]);
  const requested = params.get("view") as ViewKey | null;
  const active = allowed.some((view) => view.key === requested) ? requested! : allowed[0]?.key || "training";
  const setView = (view: ViewKey) => setParams({ view }, { replace: true });
  return <WorkspaceLayout title={copy[active].title} subtitle={copy[active].subtitle}>
    <nav className="sales-view-tabs" aria-label="Sales workspace views">
      {allowed.map(({ key, label, icon: Icon }) => <button key={key} className={active === key ? "active" : ""} aria-current={active === key ? "page" : undefined} onClick={() => setView(key)}><Icon size={16} />{label}</button>)}
    </nav>
    {active === "intelligence" && <PlatformInnovationWorkspace />}
    {active === "cases" && <CaseWorkspace />}
    {active === "pipeline" && <PipelineWorkspace />}
    {active === "training" && <TrainingWorkspace />}
    {active === "promotions" && <PromotionWorkspace />}
    {active === "campaigns" && <CampaignWorkspace />}
    {active === "opportunities" && <TalentWorkspace />}
    {active === "connectors" && <ConnectorWorkspace />}
    {active === "recurrence" && <RecurrenceWorkspace />}
    {active === "growth" && <GrowthWorkspace />}
    {active === "integrations" && <IntegrationWorkspace />}
    <footer className="sales-footer"><BarChart3 size={15} /><span>Sales tools help you plan and follow up. You only earn when a vendor confirms a sale.</span></footer>
  </WorkspaceLayout>;
}
