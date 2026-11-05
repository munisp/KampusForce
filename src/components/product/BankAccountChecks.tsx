import { useState } from "react";
import { Check, Landmark, X } from "lucide-react";
import { EmptyState, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { shortDate } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

/** Payout accounts whose bank name is close to, but not exactly, the name on the rep's ID check. */
export function BankAccountChecks() {
  const { token, user } = useWorkspace();
  const canReview = ["ops", "admin"].includes(user.role);
  const utils = trpc.useUtils();
  const list = trpc.ops.bankAccountReviews.useQuery({ token }, { enabled: canReview });
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const review = trpc.ops.reviewBankAccount.useMutation({
    onSuccess: (result) => { setNotice(`${result.accountName}: ${result.nameCheck === "approved" ? "confirmed" : "not confirmed"}. The rep has been told.`); utils.ops.bankAccountReviews.invalidate(); },
  });
  if (!canReview) return null;
  return <Panel title="Bank accounts to confirm" action={<Landmark size={18} />}>
    <p className="panel-note">The bank's name for each account is close to the name on the rep's ID check, but not the same: a short form, a spelling difference or one different word. Confirm it only if you're sure it's the same person. A relative's account is not.</p>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {review.error && <p className="form-error" role="alert">{review.error.message}</p>}
    {list.isLoading ? <Loading /> : list.error ? <ErrorState message={list.error.message} retry={list.refetch} /> : list.data?.length ? <div className="table-wrap"><table>
      <thead><tr><th>Name on ID check</th><th>Name at the bank</th><th>Account</th><th>Added</th><th>Decision</th></tr></thead>
      <tbody>{list.data.map((row) => {
        const note = (notes[row.userId] || "").trim();
        return <tr key={row.userId}>
          <td><strong>{row.idName}</strong><small className="table-sub">{row.email}</small></td>
          <td><strong>{row.accountName}</strong></td>
          <td>{row.bankName || row.bankCode}<small className="table-sub">ending {row.accountLast4}</small></td>
          <td>{shortDate(row.updatedAt)}</td>
          <td><div className="form-stack"><label className="visually-hidden" htmlFor={`bank-note-${row.userId}`}>Reason</label><input id={`bank-note-${row.userId}`} placeholder="Reason (the rep sees it if you refuse)" value={notes[row.userId] || ""} onChange={(e) => setNotes({ ...notes, [row.userId]: e.target.value })} maxLength={500} />
            <div className="decision-actions"><button className="button primary small" disabled={note.length < 5 || review.isPending} onClick={() => review.mutate({ token, userId: row.userId, approve: true, note })}><Check size={13} />Same person</button><button className="button secondary small" disabled={note.length < 5 || review.isPending} onClick={() => review.mutate({ token, userId: row.userId, approve: false, note })}><X size={13} />Not the same</button></div></div></td>
        </tr>;
      })}</tbody>
    </table></div> : <EmptyState title="Nothing to confirm" detail="Accounts whose bank name matches the ID check are confirmed automatically." />}
  </Panel>;
}
