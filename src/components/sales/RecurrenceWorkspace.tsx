import { CalendarClock, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Metric } from "@/components/product/WorkspaceLayout";
import { ErrorState, Loading } from "@/components/product/Loading";
import { shortDate, StateBadge } from "@/lib/format";
import { useActionSuccess } from "@/lib/innovationForm";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { ActionError, ActionSuccess, HashValue, NoRecords, RecordGrid, RecordItem } from "./InnovationShared";

export function RecurrenceWorkspace() {
  const { token, user } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.phase19.recurrenceWorkspace.useQuery({ token });
  const success = useActionSuccess();
  const run = trpc.phase19.runRecurrence.useMutation({ onSuccess: (result) => { utils.phase19.recurrenceWorkspace.invalidate(); success.show(`${result.awaitingEvidence} due schedules moved to awaiting evidence. ${result.dealsCreated} deals and ${result.ledgerEntriesCreated} ledger entries were created by the sweep.`); } });
  if (query.isLoading) return <Loading label="Loading renewal evidence schedules…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  return <section className="recurrence-workspace">
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.boundary}</strong></p></div>
    <div className="metrics-grid"><Metric label="Scheduled" value={data.metrics.scheduled} note="Future eligible cycles" /><Metric label="Awaiting evidence" value={data.metrics.awaitingEvidence} note="Due, not earned" tone="mustard" /><Metric label="Verified cycles" value={data.metrics.cyclesVerified} note="Signed vendor renewals" tone="teal" /><Metric label="Completed" value={data.metrics.completed} note="Maximum eligible cycles reached" /></div>
    <div className="recurrence-controls"><div><CalendarClock size={20} /><p><strong>Adjustable commercial terms</strong>Maximum renewal cycles and 1–12 month intervals are versioned in Vendor Rule Studio. New rules affect future deals only.</p></div><div><CheckCircle2 size={20} /><p><strong>Fixed economics</strong>Representative {(data.controls.standardRepShareBps / 100).toFixed(0)}% · platform {(data.controls.platformShareBps / 100).toFixed(0)}% · Campus Lead override {(data.controls.campusLeadOverrideBps / 100).toFixed(0)}% from platform revenue.</p></div><div><ShieldCheck size={20} /><p><strong>Evidence gates</strong>Original first-touch representative and commission rule are preserved. Early, excess or unattributed renewal evidence creates no new deal.</p></div></div>
    {user.role !== "finance" && <div className="promotion-ops-bar"><span>Run the due-date worker manually in this sandbox. It cannot create financial entitlement.</span><button className="button secondary small" onClick={() => run.mutate({ token })} disabled={run.isPending}><RefreshCw size={14} />Run recurrence evidence sweep</button></div>}
    <RecordGrid>{data.schedules.map((row) => <RecordItem key={row.schedule.id} title={`${row.productName} · cycle ${row.schedule.cycleNumber}/${row.schedule.maxCycles}`} meta={`Schedule #${row.schedule.id} · original deal #${row.schedule.originalDealId} · rule v${row.ruleVersion}`} status={<StateBadge state={row.schedule.state} />}><p>Every {row.schedule.intervalMonths} month{row.schedule.intervalMonths === 1 ? "" : "s"} · next eligible {row.schedule.nextDueAt ? shortDate(row.schedule.nextDueAt) : "no further cycle"}</p><small>Representative #{row.schedule.repId} · customer phone hash <HashValue value={row.schedule.customerPhoneHash} /> · last deal #{row.schedule.lastDealId}</small></RecordItem>)}{!data.schedules.length && <NoRecords title="No recurrence schedules" detail="A schedule appears only after an initial vendor-verified renewal deal is accepted under a renewal commission rule." />}</RecordGrid>
    {data.receipts.length > 0 && <><h3 className="section-heading">Append-only recurrence receipts</h3><RecordGrid>{data.receipts.map(({ receipt }) => <RecordItem key={receipt.id} title={receipt.receiptType.replaceAll("_", " ")} meta={`Schedule #${receipt.scheduleId} · cycle ${receipt.cycleNumber} · ${shortDate(receipt.createdAt)}`} status={<StateBadge state={receipt.dealId ? `deal #${receipt.dealId}` : "no deal"} />}><p>{receipt.detail}</p><small>Vendor event {receipt.vendorEventId || "awaiting signed evidence"}</small></RecordItem>)}</RecordGrid></>}
    {success.message && <ActionSuccess>{success.message}</ActionSuccess>}<ActionError error={run.error} />
  </section>;
}
