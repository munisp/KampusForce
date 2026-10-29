import { useState } from "react";
import { BadgeCheck, BrainCircuit, FileSearch, ShieldCheck, Trash2 } from "lucide-react";
import { shortDate, StateBadge } from "@/lib/format";
import { formDate, formValue, localDateInput, useActionSuccess } from "@/lib/innovationForm";
import type { RouterOutputs } from "@/lib/routerTypes";
import { trpc } from "@/providers/trpc";
import { useWorkspace } from "@/providers/workspace";
import { ActionError, ActionSuccess, FormActions, NoRecords, RecordGrid, RecordItem } from "./InnovationShared";

type TalentData = RouterOutputs["talent"]["workspace"];
type DocumentRow = TalentData["documents"][number];

function fieldValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DocumentIntelligence({ applicationId, documents, analyses, applicantRetention }: { applicationId: number; documents: DocumentRow[]; analyses: TalentData["documentAnalyses"]; applicantRetention: Date }) {
  const { token, user } = useWorkspace();
  const [initialNow] = useState(() => new Date());
  const utils = trpc.useUtils();
  const success = useActionSuccess();
  const refresh = () => { utils.talent.workspace.invalidate(); success.show("Document-analysis state updated. Application stage, score and all financial records remain unchanged."); };
  const options = { onSuccess: refresh } as const;
  const analyze = trpc.phase19.analyzeDocument.useMutation(options);
  const review = trpc.phase19.reviewDocumentAnalysis.useMutation(options);
  const withdraw = trpc.phase19.withdrawDocumentAnalysis.useMutation(options);
  const canEdit = user.role !== "finance";
  const canReview = ["vendor", "ops", "admin"].includes(user.role);
  const own = analyses.filter((analysis) => analysis.applicationId === applicationId);
  const activeDocuments = documents.filter((document) => !document.deletedAt && !document.purgedAt);
  const defaultRetention = localDateInput(new Date(Math.min(applicantRetention.getTime(), initialNow.getTime() + 30 * 86_400_000)));
  const errors = [analyze.error, review.error, withdraw.error].filter(Boolean);
  return <div className="document-intelligence">
    <div className="sandbox-banner"><BrainCircuit size={18} /><p><strong>Consented document intelligence, never automated selection.</strong> External mode uses PaddleOCR, Docling and a bounded VLM. Source text is transient; only limited educational evidence is retained for independent human review. Fixture mode is metadata-only and never claims OCR.</p></div>
    {canEdit && activeDocuments.map((document) => {
      const existing = own.find((analysis) => analysis.documentId === document.id && !["failed", "withdrawn", "purged"].includes(analysis.state));
      return <form key={`${document.id}-${existing?.id || "new"}`} className="innovation-form compact" onSubmit={(event) => { event.preventDefault(); analyze.mutate({ token, documentId: document.id, consentVersion: formValue(event, "consentVersion"), consentedAt: formDate(event, "consentedAt"), retentionUntil: formDate(event, "retentionUntil") }); }}>
        <h3><FileSearch size={17} />Analyse {document.fileName}</h3>
        <p className="form-hint">PDF, PNG, JPEG or WebP up to 10 MiB. Processing availability and mode are controlled by the server; failure persists no extracted source text.</p>
        <div className="innovation-form-grid three"><label>Analysis consent version<input required name="consentVersion" defaultValue="document-intelligence-v1" /></label><label>Consented at<input required name="consentedAt" type="datetime-local" defaultValue={localDateInput(initialNow)} /></label><label>Purge analysis by<input required name="retentionUntil" type="datetime-local" defaultValue={defaultRetention} max={localDateInput(applicantRetention)} /></label></div>
        <label className="contract-check"><input type="checkbox" required disabled={!!existing} defaultChecked={!!existing} />The applicant explicitly consented to transient OCR/Docling/VLM processing and bounded evidence retention</label>
        <FormActions><button className="button secondary small" disabled={analyze.isPending || !!existing}><FileSearch size={14} />{existing ? "Analysis already active" : "Run consented analysis"}</button></FormActions>
      </form>;
    })}
    <RecordGrid>{own.map((analysis) => <RecordItem key={analysis.id} title={`Document analysis #${analysis.id}`} meta={`${analysis.processorMode.replaceAll("_", " ")} · consent ${analysis.consentVersion} · purge by ${shortDate(analysis.retentionUntil)}`} status={<StateBadge state={analysis.state} />}>
      <small>Providers: {analysis.providersJson.join(", ") || "none"} · confidence {analysis.confidenceBps == null ? "not available" : `${(analysis.confidenceBps / 100).toFixed(1)}%`}</small>
      {analysis.qualityFlagsJson.length > 0 && <p>Quality flags: {analysis.qualityFlagsJson.join(" · ")}</p>}
      {Object.entries(analysis.extractedFieldsJson).length > 0 && <dl className="analysis-fields">{Object.entries(analysis.extractedFieldsJson).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{fieldValue(value)}</dd></div>)}</dl>}
      {analysis.errorCode && <p className="form-error">{analysis.errorCode.replaceAll("_", " ")} · no extracted text was saved</p>}
      {analysis.reviewNote && <p>Human review: {analysis.reviewNote}</p>}
      <small>Source SHA-256 verified · raw text persisted: {String(analysis.rawTextPersisted)} · automated decision: {String(analysis.automatedDecision)}</small>
      <div className="innovation-record-actions">{canReview && analysis.state === "needs_review" && <><button className="button primary small" onClick={() => review.mutate({ token, analysisId: analysis.id, decision: "approved", note: "Bounded extracted evidence checked against the source document by an independent human reviewer." })}><BadgeCheck size={14} />Approve evidence</button><button className="button secondary small" onClick={() => review.mutate({ token, analysisId: analysis.id, decision: "rejected", note: "Extracted evidence is not sufficiently reliable for the human selection record." })}>Reject evidence</button></>}{canEdit && !analysis.purgedAt && <button className="button secondary small" onClick={() => withdraw.mutate({ token, analysisId: analysis.id })}><Trash2 size={14} />Withdraw & purge analysis</button>}</div>
    </RecordItem>)}{!own.length && <NoRecords title="No document analyses" detail="Analysis is a separate consented action after upload; uploading alone never starts OCR or a VLM." />}</RecordGrid>
    <p className="panel-footnote"><ShieldCheck size={14} />Reviewing extracted evidence does not change the application score or stage and never creates attribution, a deal, a ledger entry or commission.</p>
    {success.message && <ActionSuccess>{success.message}</ActionSuccess>}{errors.map((error, index) => <ActionError key={index} error={error} />)}
  </div>;
}
