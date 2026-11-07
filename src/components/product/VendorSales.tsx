import { useState } from "react";
import { CheckCircle2, Clock3, ImagePlus, Pause, Pencil, Play, Trash2, X } from "lucide-react";
import { EmptyState, Panel } from "./WorkspaceLayout";
import { Loading, ErrorState } from "./Loading";
import { money, productCategories, shortDate, StateBadge } from "@/lib/format";
import { fileToBase64, shrinkPhoto } from "@/lib/files";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

// The vendor's side of the sales flow: every sale campus reps record (from the moment it's recorded), what each one
// cost and paid, the wallet's history, and managing the products reps sell.

const SALE_STATE: Record<string, { label: string; cls: string }> = {
  waiting: { label: "KampusForce is checking", cls: "waiting" },
  verified: { label: "Verified", cls: "ok" },
  rejected: { label: "Rejected", cls: "no" },
};

/** Sales reps recorded for this vendor, with the money for each. A sale Operations approved can be disputed during its refund period. */
export function VendorRecordedSales() {
  const { token } = useWorkspace();
  const utils = trpc.useUtils();
  const list = trpc.vendor.recordedSales.useQuery({ token });
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const dispute = trpc.vendor.disputeVerifiedSale.useMutation({ onSuccess: () => { setOpen(null); setReason(""); setNotice("Disputed. The commission is on hold while KampusForce reviews it. If they agree, it goes back to your wallet."); utils.vendor.recordedSales.invalidate(); utils.vendor.overview.invalidate(); } });
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={list.error.message} retry={list.refetch} />;
  const rows = list.data || [];
  const waiting = rows.filter((row) => row.sale.state === "waiting").length;
  return <Panel title="Sales reps recorded" action={<span className="result-count">{waiting ? `${waiting} being checked · ` : ""}{rows.length} in all</span>}>
    <p className="panel-note">Campus reps record each sale with proof. It shows here straight away. KampusForce checks the proof; once it's approved, the commission comes out of your wallet and the rep is paid. If a sale didn't happen or was refunded, dispute it before its refund period ends.</p>
    {notice && <p className="success-message" role="status"><CheckCircle2 size={16} />{notice}</p>}
    {dispute.error && <p className="form-error" role="alert">{dispute.error.message}</p>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Recorded</th><th>Product</th><th>Sale</th><th>Rep</th><th>Customer</th><th>Status</th><th>Commission</th><th></th></tr></thead><tbody>{rows.map((row) => {
      const { sale, productName, repCode, dealState, split, refundUntil, canDispute } = row;
      return <tr key={sale.id}>
        <td>{shortDate(sale.createdAt)}</td>
        <td><strong>{productName}</strong></td>
        <td>{sale.amountKobo ? <>{sale.quantity} × {money(sale.unitPriceKobo || 0)}<small className="table-sub">{money(sale.amountKobo)}</small></> : "—"}</td>
        <td className="mono">{repCode}</td>
        <td className="mono">•••• {sale.customerPhoneLast4}</td>
        <td><span className={`new-rep-badge ${SALE_STATE[sale.state]?.cls || "waiting"}`}>{SALE_STATE[sale.state]?.label || sale.state}</span>
          {sale.state === "verified" && <small className="table-sub">{sale.verifiedBy === "vendor" ? "You reported it" : "Approved by KampusForce"}{dealState && dealState !== "payable" ? ` · ${dealState === "disputed" ? "disputed" : dealState.replaceAll("_", " ")}` : ""}</small>}
          {sale.state === "rejected" && sale.reviewReason && <small className="table-sub">{sale.reviewReason}</small>}</td>
        <td>{split ? <>{money(split.vendorCommissionKobo)}<small className="table-sub">{split.final ? "Paid" : "Would be"}: rep {money(split.repCommissionKobo)} · KampusForce {money(split.platformFeeKobo)}</small></> : "—"}</td>
        <td>{canDispute && (open === sale.id
          ? <form className="form-stack" onSubmit={(e) => { e.preventDefault(); dispute.mutate({ token, id: sale.id, reason }); }}>
            <input aria-label="What's wrong with this sale?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No such order, or the customer was refunded" minLength={10} maxLength={1000} required />
            <div className="decision-actions"><button type="button" className="button secondary small" onClick={() => setOpen(null)}><X size={13} />Cancel</button><button className="button primary small" disabled={reason.trim().length < 10 || dispute.isPending}>Send dispute</button></div>
          </form>
          : <><button className="button secondary small" onClick={() => { setOpen(sale.id); setReason(""); }}>Dispute</button>{refundUntil && <small className="table-sub">until {shortDate(refundUntil)}</small>}</>)}</td>
      </tr>;
    })}</tbody></table></div> : <EmptyState title="No sales recorded yet" detail="When a campus rep records a sale of one of your products, it shows here." />}
  </Panel>;
}

const WALLET_LINE: Record<string, string> = { funds_added: "Funds added", commission_paid: "Commission paid", commission_returned: "Commission returned" };

export function VendorWalletHistory() {
  const { token } = useWorkspace();
  const list = trpc.vendor.walletHistory.useQuery({ token });
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorState message={list.error.message} retry={list.refetch} />;
  const rows = list.data || [];
  return <Panel title="Wallet history" action={<span className="result-count">{rows.length} entries</span>}>
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>What</th><th>Details</th><th className="numeric">Amount</th></tr></thead><tbody>{rows.map((line, index) => <tr key={`${line.kind}-${line.dealId ?? "topup"}-${index}`}>
      <td>{shortDate(line.at)}</td><td>{WALLET_LINE[line.kind]}</td><td>{line.detail}</td>
      <td className={`numeric mono ${line.amountKobo < 0 ? "negative" : "positive"}`}>{line.amountKobo < 0 ? "−" : "+"}{money(Math.abs(line.amountKobo))}</td>
    </tr>)}</tbody></table></div> : <EmptyState title="Nothing yet" detail="Money you add and commission paid for sales show here." />}
  </Panel>;
}

type CatalogRow = {
  product: { id: number; name: string; description: string; category: string; priceKobo: number; landingUrl: string; status: string; stockQuantity: number | null; vendorRef: string };
  rule: { basis: "flat" | "pct"; pctBps: number | null; flatAmountKobo: number | null; triggerEvent: string; clawbackDays: number };
  images: string[];
};

/** The vendor's products: photos, details, price, stock, and whether reps can sell it. */
export function VendorProducts({ catalog, onChanged }: { catalog: CatalogRow[]; onChanged: () => void }) {
  return <Panel title="Your products" action={<span className="result-count">{catalog.length} listed</span>}>
    {catalog.length ? <div className="vendor-product-list">{catalog.map((row) => <VendorProductCard key={row.product.id} row={row} onChanged={onChanged} />)}</div>
      : <EmptyState title="No products yet" detail="Add your first product below. Reps can sell it as soon as it's listed." />}
  </Panel>;
}

function VendorProductCard({ row, onChanged }: { row: CatalogRow; onChanged: () => void }) {
  const { token } = useWorkspace();
  const { product, rule, images } = row;
  const isProductSale = rule.triggerEvent === "sale";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: product.name, description: product.description, category: product.category, price: String(product.priceKobo / 100), stock: product.stockQuantity === null ? "" : String(product.stockQuantity), link: product.landingUrl });
  const [uploading, setUploading] = useState("");
  const update = trpc.vendor.updateProduct.useMutation({ onSuccess: () => { setEditing(false); onChanged(); } });
  const status = trpc.vendor.setProductStatus.useMutation({ onSuccess: onChanged });
  const addImage = trpc.vendor.addProductImage.useMutation({ onSuccess: onChanged });
  const removeImage = trpc.vendor.removeProductImage.useMutation({ onSuccess: onChanged });
  const upload = async (file?: File | null) => {
    if (!file) return;
    setUploading("Preparing the photo…");
    const ready = await shrinkPhoto(file);
    addImage.mutate({ token, productId: product.id, contentBase64: await fileToBase64(ready) }, { onSettled: () => setUploading("") });
  };
  const commission = rule.basis === "flat" ? `${money(rule.flatAmountKobo || 0)}${isProductSale ? " per unit" : ""}` : `${(rule.pctBps || 0) / 100}%${isProductSale ? " of the sale" : ""}`;
  const error = update.error || status.error || addImage.error || removeImage.error;
  return <article className="vendor-product">
    <div className="product-photos">
      {images.map((url) => <figure key={url}><img src={url} alt={product.name} loading="lazy" /><button className="icon-button" aria-label="Remove this photo" disabled={removeImage.isPending} onClick={() => removeImage.mutate({ token, imageId: Number(url.split("/").pop()) })}><Trash2 size={13} /></button></figure>)}
      {images.length < 6 && <label className="photo-add"><ImagePlus size={18} /><span>{uploading || "Add photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={Boolean(uploading)} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>}
    </div>
    {editing ? <form className="form-stack" onSubmit={(e) => { e.preventDefault(); update.mutate({ token, productId: product.id, name: form.name, description: form.description, category: form.category as "other", priceKobo: Math.round(Number(form.price || 0) * 100), stockQuantity: form.stock === "" ? null : Number(form.stock), landingUrl: form.link || undefined }); }}>
      <label>Product name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={3} required /></label>
      <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} minLength={10} required /></label>
      <div className="form-row">
        <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.entries(productCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Price (₦)<input type="number" min={isProductSale ? 1 : 0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required={isProductSale} /></label>
        {isProductSale && <label>In stock<input type="number" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="Not tracked" /></label>}
      </div>
      <label>Link customers go to {isProductSale && <span className="optional">optional</span>}<input type="url" placeholder="https://" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} required={!isProductSale} /></label>
      <div className="decision-actions"><button type="button" className="button secondary small" onClick={() => setEditing(false)}><X size={13} />Cancel</button><button className="button primary small" disabled={update.isPending}>Save changes</button></div>
    </form> : <div className="vendor-product-body">
      <header><div><strong>{product.name}</strong><small>{productCategories[product.category] || product.category} · code <span className="mono">{product.vendorRef}</span></small></div><StateBadge state={product.status === "active" ? "on_sale" : product.status} /></header>
      <p>{product.description}</p>
      <dl className="product-terms">
        <div><dt>Price</dt><dd>{product.priceKobo ? money(product.priceKobo) : "—"}</dd></div>
        {isProductSale && <div><dt>In stock</dt><dd>{product.stockQuantity === null ? "Not tracked" : product.stockQuantity === 0 ? "Sold out" : product.stockQuantity}</dd></div>}
        <div><dt>Commission</dt><dd>{commission}</dd></div>
        <div><dt>Refund period</dt><dd>{rule.clawbackDays} days</dd></div>
      </dl>
      <div className="decision-actions">
        <button className="button secondary small" onClick={() => setEditing(true)}><Pencil size={13} />Edit</button>
        {product.status === "active"
          ? <button className="button secondary small" disabled={status.isPending} onClick={() => status.mutate({ token, productId: product.id, status: "paused" })}><Pause size={13} />Pause sales</button>
          : <button className="button primary small" disabled={status.isPending} onClick={() => status.mutate({ token, productId: product.id, status: "active" })}><Play size={13} />Put on sale</button>}
      </div>
      {product.status !== "active" && <p className="panel-footnote"><Clock3 size={13} /> Paused: reps can't see or record sales of this product.</p>}
    </div>}
    {error && <p className="form-error" role="alert">{error.message}</p>}
  </article>;
}
