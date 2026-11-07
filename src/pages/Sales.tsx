import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { BarChart3, BookOpenCheck, BriefcaseBusiness, CalendarClock, Megaphone, Target } from "lucide-react";
import { WorkspaceLayout } from "@/components/product/WorkspaceLayout";
import { useWorkspace } from "@/providers/workspace";
import { PipelineWorkspace } from "@/components/sales/PipelineWorkspace";
import { TrainingWorkspace } from "@/components/sales/TrainingWorkspace";
import { CampaignWorkspace } from "@/components/sales/CampaignWorkspace";
import { GrowthWorkspace } from "@/components/sales/GrowthWorkspace";
import { PromotionWorkspace } from "@/components/sales/PromotionWorkspace";
import { RecurrenceWorkspace } from "@/components/sales/RecurrenceWorkspace";

// Tools around selling, each for the roles that use it. Support requests live on each role's own Support page,
// and verification, payments and checks on the role dashboards, so they aren't repeated here.
const views = [
  { key: "training", label: "Training", icon: BookOpenCheck, roles: ["rep", "ops", "admin"] },
  { key: "pipeline", label: "My contacts", icon: BriefcaseBusiness, roles: ["rep"] },
  { key: "growth", label: "Growth", icon: Target, roles: ["rep", "ops", "admin"] },
  { key: "promotions", label: "Promotions", icon: Megaphone, roles: ["rep", "vendor", "ops", "admin"] },
  { key: "campaigns", label: "Campaigns", icon: Megaphone, roles: ["rep", "vendor", "ops", "admin"] },
  { key: "recurrence", label: "Renewals", icon: CalendarClock, roles: ["vendor", "ops", "finance", "admin"] },
] as const;

type ViewKey = typeof views[number]["key"];

const copy: Record<ViewKey, { title: string; subtitle: string }> = {
  training: { title: "Training", subtitle: "Short lessons on selling honestly, privacy, and the products and campaigns you work on." },
  pipeline: { title: "My contacts", subtitle: "Keep track of the people you're talking to and when to follow up." },
  growth: { title: "Growth", subtitle: "Leaderboards, product targets and inviting new reps to join." },
  promotions: { title: "Promotions", subtitle: "Vendor offers you can promote on campus, and how they're doing." },
  campaigns: { title: "Campaigns", subtitle: "Choose who to reach, get approval, and see the results." },
  recurrence: { title: "Renewals", subtitle: "Commission on a renewal is paid only once the vendor confirms it." },
};

export default function Sales() {
  const { user } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const allowed = useMemo(() => views.filter((view) => (view.roles as readonly string[]).includes(user.role)), [user.role]);
  const requested = params.get("view") as ViewKey | null;
  const active = allowed.some((view) => view.key === requested) ? requested! : allowed[0]?.key || "recurrence";
  const setView = (view: ViewKey) => setParams({ view }, { replace: true });
  return <WorkspaceLayout title={copy[active].title} subtitle={copy[active].subtitle}>
    <nav className="sales-view-tabs" aria-label="Sales workspace views">
      {allowed.map(({ key, label, icon: Icon }) => <button key={key} className={active === key ? "active" : ""} aria-current={active === key ? "page" : undefined} onClick={() => setView(key)}><Icon size={16} />{label}</button>)}
    </nav>
    {active === "pipeline" && <PipelineWorkspace />}
    {active === "training" && <TrainingWorkspace />}
    {active === "promotions" && <PromotionWorkspace />}
    {active === "campaigns" && <CampaignWorkspace />}
    {active === "recurrence" && <RecurrenceWorkspace />}
    {active === "growth" && <GrowthWorkspace />}
    <footer className="sales-footer"><BarChart3 size={15} /><span>Sales tools help you plan and follow up. You earn when a sale you recorded is approved.</span></footer>
  </WorkspaceLayout>;
}
