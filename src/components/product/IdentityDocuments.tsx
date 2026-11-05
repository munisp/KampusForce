import { useState } from "react";
import { Check, Eye, Upload } from "lucide-react";
import { base64ToObjectUrl, documentLabels, fileToBase64, formatBytes, GOVERNMENT_ID_TYPES, idTypeLabel, MAX_DOCUMENT_BYTES, shrinkPhoto, type GovernmentIdType } from "@/lib/files";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type Document = { id: number; kind: string; idType?: string | null; contentType: string; sizeBytes: number };
const ID_KINDS = ["government_id", "owner_id"];

export function DocumentPreview({ documentId, label }: { documentId: number; label: string }) {
  const { token } = useWorkspace();
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const view = trpc.identity.viewDocument.useMutation({ onSuccess: (file) => setPreview({ url: base64ToObjectUrl(file.contentBase64, file.contentType), contentType: file.contentType }) });
  return <div className="identity-document-preview">
    <button type="button" aria-label={`View ${label}`} className="button secondary small" disabled={view.isPending} onClick={() => view.mutate({ token, documentId })}><Eye size={14} />{view.isPending ? "Opening…" : "View"}</button>
    {view.error && <p className="form-error" role="alert">{view.error.message}</p>}
    {preview && (preview.contentType === "application/pdf"
      ? <a className="text-link" href={preview.url} target="_blank" rel="noreferrer">Open the PDF</a>
      : <img src={preview.url} alt={label} />)}
  </div>;
}

export function DocumentUploads({ caseId, kinds, documents, disabled, onChange }: { caseId: number; kinds: string[]; documents: Document[]; disabled: boolean; onChange: () => void }) {
  const { token } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [idTypes, setIdTypes] = useState<Record<string, GovernmentIdType | "">>(() => Object.fromEntries(documents.filter((d) => d.idType).map((d) => [d.kind, d.idType as GovernmentIdType])));
  const upload = trpc.identity.uploadDocument.useMutation();
  const choose = async (kind: string, file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_DOCUMENT_BYTES) { setError("That file is too big. The limit is 10 MB."); return; }
    if (ID_KINDS.includes(kind) && !idTypes[kind]) { setError("Choose which ID you're uploading first."); return; }
    setBusy(kind);
    try {
      setStatus("Preparing…");
      const ready = await shrinkPhoto(file);
      setStatus(`Uploading ${formatBytes(ready.size)}…`);
      await upload.mutateAsync({ token, caseId, kind: kind as "government_id", idType: ID_KINDS.includes(kind) ? idTypes[kind] as GovernmentIdType : undefined, contentBase64: await fileToBase64(ready) });
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That upload failed. Please try again.");
    } finally {
      setBusy("");
      setStatus("");
    }
  };
  return <div className="identity-uploads">
    {kinds.map((kind) => {
      const current = documents.find((document) => document.kind === kind);
      return <div key={kind} className={`identity-upload${current ? " done" : ""}`}>
        <p><strong>{documentLabels[kind]?.title || kind}</strong><small>{documentLabels[kind]?.hint}</small></p>
        {ID_KINDS.includes(kind) && <label className="identity-id-type">Which ID?<select data-id-type={kind} value={idTypes[kind] || ""} disabled={disabled || !!busy} onChange={(event) => setIdTypes({ ...idTypes, [kind]: event.target.value as GovernmentIdType })}><option value="">Choose one</option>{GOVERNMENT_ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>}
        {current && <span className="identity-upload-state"><Check size={14} />Uploaded{current.idType ? ` · ${idTypeLabel(current.idType)}` : ""}</span>}
        <label className={`button secondary small${disabled || busy || (ID_KINDS.includes(kind) && !idTypes[kind]) ? " disabled" : ""}`} title={ID_KINDS.includes(kind) && !idTypes[kind] ? "Choose which ID first" : undefined}>
          <Upload size={14} />{busy === kind ? status || "Uploading…" : current ? "Replace" : "Choose file"}
          <input data-document={kind} className="visually-hidden" type="file" accept={kind === "selfie" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"} capture={kind === "selfie" ? "user" : undefined} disabled={disabled || !!busy || (ID_KINDS.includes(kind) && !idTypes[kind])} onChange={(event) => { void choose(kind, event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>;
    })}
    <small className="identity-upload-note">JPG, PNG or PDF, up to 10 MB each.</small>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
