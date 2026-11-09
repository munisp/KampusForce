import { useMemo, useState } from "react";
import { Ban, Check, Search, Undo2 } from "lucide-react";
import { EmptyState, Panel } from "./WorkspaceLayout";
import { ErrorState, Loading } from "./Loading";
import { money, productCategories, shortDate } from "@/lib/format";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

// Every product on KampusForce, so Operations can take down a listing that breaks the rules. A taken-down product leaves
// the reps' catalog at once, and its vendor can't put it back on sale until Operations lifts the hold.

const statusOf = (p: { status: string; heldReason: string | null }) => p.heldReason ? { label: "Taken down", cls: "no" } : p.status === "active" ? { label: "On sale", cls: "ok" } : { label: "Paused by vendor", cls: "waiting" };

export function OpsProducts() {
  const { token, user } = useWorkspace();
  const canAct = ["ops", "admin"].includes(user.role);
  const utils = trpc.useUtils();
  const list = trpc.ops.products.useQuery({ token });
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "active" | "held">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const done = (message: string) => { setOpen(null); setText(""); setNotice(message); utils.ops.products.invalidate(); };
  const hold = trpc.ops.holdProduct.useMutation({ onSuccess: () => done("Taken down. Reps can't see it, and the vendor has been told why.") });
  const release = trpc.ops.releaseProductHold.useMutation({ onSuccess: () => done("Hold lifted. The product stays paused until the vendor puts it back on sale.") });
  const rows = useMemo(() => (list.data || []).filter(({ product, vendorName }) =>
    (show === "all" || (show === "held" ? Boolean(product.heldReason) : product.status === "active" && !product.heldReason))
    && `${product.name} ${vendorName}`.toLowerCase().includes(search.trim().toLowerCase())), [list.data, search, show]);
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={list.error.message} retry={list.refetch} />;
  const error = hold.error || release.error;
  return <Panel title="Products" action={<span className="result-count">{rows.length} of {list.data?.length || 0}</span>}>
    <p className="panel-note">Take down a product that's misleading, unsafe or not allowed. It leaves the reps' catalog at once, its vendor is told why, and only Operations can lift the hold.</p>
    <div className="catalog-tools">
      <label className="search-field"><Search size={18} /><input id="ops-product-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or vendors" /></label>
      <label className="select-field"><select id="ops-product-show" value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show"><option value="all">All products</option><option value="active">On sale</option><option value="held">Taken down</option></select></label>
    </div>
    {notice && <p className="success-message" role="status"><Check size={16} />{notice}</p>}
    {error && <p className="form-error" role="alert">{error.message}</p>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Product</th><th>Status</th><th>Vendor</th><th>Price</th><th></th></tr></thead><tbody>{rows.map(({ product, vendorName, images }) => {
      const st = statusOf(product);
      return <tr key={product.id}>
        <td><div className="ops-product-cell">{images[0] ? <img src={images[0]} alt="" loading="lazy" /> : <span className="ops-product-thumb" aria-hidden="true" />}<div><strong>{product.name}</strong><small className="table-sub">{productCategories[product.category] || product.category}</small></div></div></td>
        <td><span className={`new-rep-badge ${st.cls}`}>{st.label}</span>{product.heldReason && <small className="table-sub">{product.heldReason}{product.heldAt ? ` · ${shortDate(product.heldAt)}` : ""}</small>}</td>
        <td>{vendorName}</td>
        <td>{product.priceKobo ? money(product.priceKobo) : "—"}</td>
        <td>{canAct && (open === product.id
          ? <form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (product.heldReason) release.mutate({ token, productId: product.id, note: text }); else hold.mutate({ token, productId: product.id, reason: text }); }}>
            <input id={`ops-product-text-${product.id}`} aria-label={product.heldReason ? "Why are you lifting the hold?" : "Why are you taking it down?"} value={text} onChange={(e) => setText(e.target.value)} placeholder={product.heldReason ? "e.g. Vendor fixed the description" : "e.g. Promises returns the vendor doesn't offer"} minLength={product.heldReason ? 5 : 10} maxLength={300} required />
            <div className="decision-actions"><button type="button" className="button secondary small" onClick={() => { setOpen(null); setText(""); }}>Cancel</button><button className="button primary small" disabled={hold.isPending || release.isPending || text.trim().length < (product.heldReason ? 5 : 10)}>{product.heldReason ? "Lift hold" : "Take down"}</button></div>
          </form>
          : <button className="button secondary small" onClick={() => { setOpen(product.id); setText(""); setNotice(""); }}>{product.heldReason ? <><Undo2 size={13} />Lift hold</> : <><Ban size={13} />Take down</>}</button>)}</td>
      </tr>;
    })}</tbody></table></div> : <EmptyState title="No products" detail="Try another search." />}
  </Panel>;
}
