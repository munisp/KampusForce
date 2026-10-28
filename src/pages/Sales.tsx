import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { BarChart3, BookOpenCheck, BriefcaseBusiness, Megaphone, PlugZap, Target, Workflow } from "lucide-react";
import { WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { useWorkspace } from "@/providers/workspace";
import { CaseWorkspace } from "@/components/sales/CaseWorkspace";
import { PipelineWorkspace } from "@/components/sales/PipelineWorkspace";
import { TrainingWorkspace } from "@/components/sales/TrainingWorkspace";
import { CampaignWorkspace } from "@/components/sales/CampaignWorkspace";
import { GrowthWorkspace } from "@/components/sales/GrowthWorkspace";
import { IntegrationWorkspace } from "@/components/sales/IntegrationWorkspace";

const views = [
  { key: "cases", label: "Case command", icon: Workflow, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "pipeline", label: "Relationship CRM", icon: BriefcaseBusiness, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "training", label: "Sales academy", icon: BookOpenCheck, roles: ["rep", "vendor", "ops", "finance", "admin"] },
  { key: "campaigns", label: "Campaign engine", icon: Megaphone, roles: ["rep", "vendor", "ops", "admin"] },
  { key: "growth", label: "Growth & recruiting", icon: Target, roles: ["rep", "ops", "finance", "admin"] },
  { key: "integrations", label: "Vendor services", icon: PlugZap, roles: ["vendor", "ops", "admin"] },
] as const;

type ViewKey = typeof views[number]["key"];

const copy: Record<ViewKey, { title: string; subtitle: string }> = {
  cases: { title: "Every case has a next move.", subtitle: "Ownership, response clocks, collaboration and evidence—without touching the financial ledger." },
  pipeline: { title: "Relationships, not pipeline theatre.", subtitle: "A complete activity record, explainable priorities and human-approved follow-up." },
  training: { title: "Skill before scale.", subtitle: "Short internal modules turn ethical sales, privacy and service boundaries into assessed readiness." },
  campaigns: { title: "Campaigns with a control tower.", subtitle: "Audience rules, independent approval, in-app delivery and record-derived conversion." },
  growth: { title: "Grow the right relationships.", subtitle: "Verified-outcome leaderboards, explainable product targets and consent-led student recruiting." },
  integrations: { title: "Vendor services, visibly bounded.", subtitle: "Local configuration, tests and synchronization evidence with no hidden external execution." },
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
    {active === "cases" && <CaseWorkspace />}
    {active === "pipeline" && <PipelineWorkspace />}
    {active === "training" && <TrainingWorkspace />}
    {active === "campaigns" && <CampaignWorkspace />}
    {active === "growth" && <GrowthWorkspace />}
    {active === "integrations" && <IntegrationWorkspace />}
    <footer className="sales-footer"><BarChart3 size={15} /><span>Phase 12 coordinated sales release · deterministic rules · sandbox evidence only</span></footer>
  </WorkspaceLayout>;
}
