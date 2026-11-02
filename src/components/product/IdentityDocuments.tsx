import { useState } from "react";
import { Check, Eye, Upload } from "lucide-react";
import { base64ToObjectUrl, documentLabels, fileToBase64, MAX_DOCUMENT_BYTES } from "@/lib/files";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";

type Document = { id: number; kind: string; contentType: string; sizeBytes: number };

export function DocumentPreview({ documentId, label }: { documentId: number; label: string }) {
  const { token } = useWorkspace();
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const view = trpc.identity.viewDocument.useMutation({ onSuccess: (file) => setPreview({ url: base64ToObjectUrl(file.contentBase64, file.contentType), contentType: file.contentType }) });
  return <div className="identity-document-preview">
    <button type="button" className="button secondary small" disabled={view.isPending} onClick={() => view.mutate({ token, documentId })}><Eye size={14} />{view.isPending ? "Opening…" : `View ${label}`}</button>
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
  const upload = trpc.identity.uploadDocument.useMutation();
  const choose = async (kind: string, file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_DOCUMENT_BYTES) { setError("That file is too big. The limit is 10 MB."); return; }
    setBusy(kind);
    try {
      await upload.mutateAsync({ token, caseId, kind: kind as "government_id", contentBase64: await fileToBase64(file) });
      onChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That upload failed. Please try again.");
    } finally {
      setBusy("");
    }
  };
  return <div className="identity-uploads">
    {kinds.map((kind) => {
      const current = documents.find((document) => document.kind === kind);
      return <div key={kind} className={`identity-upload${current ? " done" : ""}`}>
        <p><strong>{documentLabels[kind]?.title || kind}</strong><small>{documentLabels[kind]?.hint}</small></p>
        {current && <span className="identity-upload-state"><Check size={14} />Uploaded</span>}
        <label className={`button secondary small${disabled || busy ? " disabled" : ""}`}>
          <Upload size={14} />{busy === kind ? "Uploading…" : current ? "Replace" : "Choose file"}
          <input data-document={kind} className="visually-hidden" type="file" accept={kind === "selfie" ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"} capture={kind === "selfie" ? "user" : undefined} disabled={disabled || !!busy} onChange={(event) => { void choose(kind, event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>;
    })}
    <small className="identity-upload-note">JPG, PNG or PDF, up to 10 MB each.</small>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
