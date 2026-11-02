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
  if (query.isLoading) return <Loading label="Loading renewals…" />;
  if (query.error) return <ErrorState message={query.error.message} retry={query.refetch} />;
  const data = query.data!;
  return <section className="recurrence-workspace">
    <div className="sandbox-banner"><ShieldCheck size={18} /><p><strong>{data.boundary}</strong></p></div>
    <div className="metrics-grid"><Metric label="Scheduled" value={data.metrics.scheduled} note="Renewals still to come" /><Metric label="Waiting for the vendor" value={data.metrics.awaitingEvidence} note="Due, but not earned yet" tone="mustard" /><Metric label="Confirmed renewals" value={data.metrics.cyclesVerified} note="Confirmed by the vendor" tone="teal" /><Metric label="Completed" value={data.metrics.completed} note="No more renewals pay" /></div>
    <div className="recurrence-controls"><div><CalendarClock size={20} /><p><strong>What you can change</strong>Set how many renewals pay, and how often, in Commission terms. Changes only affect new sales.</p></div><div><CheckCircle2 size={20} /><p><strong>What stays the same</strong>Representative {(data.controls.standardRepShareBps / 100).toFixed(0)}% · platform {(data.controls.platformShareBps / 100).toFixed(0)}% · Campus Lead override {(data.controls.campusLeadOverrideBps / 100).toFixed(0)}% from platform revenue.</p></div><div><ShieldCheck size={20} /><p><strong>Evidence gates</strong>The same rep and the same terms apply to every renewal. Early or extra renewals don't earn anything.</p></div></div>
    {user.role !== "finance" && <div className="promotion-ops-bar"><span>Check which renewals are due. This doesn't pay anything.</span><button className="button secondary small" onClick={() => run.mutate({ token })} disabled={run.isPending}><RefreshCw size={14} />Check renewals</button></div>}
    <RecordGrid>{data.schedules.map((row) => <RecordItem key={row.schedule.id} title={`${row.productName} · cycle ${row.schedule.cycleNumber}/${row.schedule.maxCycles}`} meta={`Schedule #${row.schedule.id} · original deal #${row.schedule.originalDealId} · rule v${row.ruleVersion}`} status={<StateBadge state={row.schedule.state} />}><p>Every {row.schedule.intervalMonths} month{row.schedule.intervalMonths === 1 ? "" : "s"} · next eligible {row.schedule.nextDueAt ? shortDate(row.schedule.nextDueAt) : "no further cycle"}</p><small>Representative #{row.schedule.repId} · customer phone hash <HashValue value={row.schedule.customerPhoneHash} /> · last deal #{row.schedule.lastDealId}</small></RecordItem>)}{!data.schedules.length && <NoRecords title="No renewals yet" detail="Renewals appear after a vendor confirms the first one." />}</RecordGrid>
    {data.receipts.length > 0 && <><h3 className="section-heading">History</h3><RecordGrid>{data.receipts.map(({ receipt }) => <RecordItem key={receipt.id} title={receipt.receiptType.replaceAll("_", " ")} meta={`Schedule #${receipt.scheduleId} · cycle ${receipt.cycleNumber} · ${shortDate(receipt.createdAt)}`} status={<StateBadge state={receipt.dealId ? `deal #${receipt.dealId}` : "no deal"} />}><p>{receipt.detail}</p><small>Vendor event {receipt.vendorEventId || "awaiting signed evidence"}</small></RecordItem>)}</RecordGrid></>}
    {success.message && <ActionSuccess>{success.message}</ActionSuccess>}<ActionError error={run.error} />
  </section>;
}
